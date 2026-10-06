import {Tables} from "@/api/db/tables.ts";
import type {ImportDbLike} from "@/lib/data-import/types.ts";

export async function fetchExistingKitchenRaw(
  db: ImportDbLike,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const name = String(patch.name ?? "").trim();
  if (!name) return null;

  const [rows] = await db.query(
    `SELECT id, name, priority, items, printers FROM ${Tables.kitchens}
     WHERE string::lowercase(name) = string::lowercase($name) AND deleted_at = none
     FETCH items, printers`,
    {name},
  );
  const row = rows?.[0];
  if (!row) return null;

  const items = (row.items ?? []).map((item: any) => {
    const dishName = String(item?.name ?? "").trim();
    const dishNumber = String(item?.number ?? "").trim();
    return dishNumber || dishName;
  }).filter(Boolean);

  const printers = (row.printers ?? []).map((p: any) => String(p?.name ?? "").trim()).filter(Boolean);

  return {
    name: row.name,
    priority: row.priority,
    items,
    printers,
  };
}

export async function fetchExistingDishRaw(
  db: ImportDbLike,
  number: string,
): Promise<Record<string, unknown> | null> {
  const [rows] = await db.query(
    `SELECT * FROM ${Tables.dishes} WHERE number = $number AND deleted_at = none LIMIT 1 FETCH categories, tax, workflow`,
    {number},
  );
  const dish = rows?.[0];
  if (!dish) return null;

  const categories = Array.isArray(dish.categories)
    ? dish.categories
        .filter((c: any) => c && c.id)
        .map((c: any) => ({label: String(c.name ?? ""), id: String(c.id)}))
    : [];
  const tax = dish.tax && dish.tax.id
    ? {label: String(dish.tax.name ?? ""), id: String(dish.tax.id)}
    : undefined;

  const workflowName = dish.workflow?.name ? String(dish.workflow.name) : undefined;
  let stageOverridesJson: string | undefined;
  if (dish.stage_overrides && dish.workflow?.id) {
    const [stages] = await db.query(
      `SELECT id, name, kitchen.name AS kitchen_name FROM ${Tables.workflow_stages}
       WHERE workflow = $wf ORDER BY sequence ASC FETCH kitchen`,
      {wf: dish.workflow.id},
    );
    const overrideMap: Record<string, string> = {};
    for (const [stageId, kitchenId] of Object.entries(dish.stage_overrides as Record<string, unknown>)) {
      const stage = (stages ?? []).find((s: any) => String(s.id) === String(stageId));
      const kitchen = (stages ?? []).find((s: any) =>
        String(s.kitchen?.id ?? s.kitchen) === String(kitchenId),
      );
      if (stage?.name && kitchen?.kitchen_name) {
        overrideMap[stage.name] = kitchen.kitchen_name;
      }
    }
    if (Object.keys(overrideMap).length > 0) {
      stageOverridesJson = JSON.stringify(overrideMap);
    }
  }

  return {
    name: dish.name,
    number: dish.number,
    priority: dish.priority,
    price: dish.price,
    categories,
    tax,
    workflow: workflowName,
    stage_overrides: stageOverridesJson,
  };
}

export async function fetchExistingTableRaw(
  db: ImportDbLike,
  number: string,
): Promise<Record<string, unknown> | null> {
  const [rows] = await db.query(
    `SELECT * FROM ${Tables.tables} WHERE number = $number AND deleted_at = none LIMIT 1 FETCH floor, categories, order_types, payment_types`,
    {number},
  );
  const row = rows?.[0];
  if (!row) return null;

  return {
    name: row.name,
    number: row.number,
    ask_for_covers: row.ask_for_covers,
    background: row.background,
    color: row.color,
    priority: row.priority,
    floor: row.floor?.name ?? "",
    categories: (row.categories ?? []).map((c: any) => String(c.name ?? "")),
    order_types: (row.order_types ?? []).map((o: any) => String(o.name ?? "")),
    payment_types: (row.payment_types ?? []).map((p: any) => String(p.name ?? "")),
  };
}

export async function fetchExistingDishModifierRaw(
  db: ImportDbLike,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const dishNumber = String(patch.dish_number ?? "").trim();
  const groupLabel = String(patch.modifier_group ?? "").trim();
  if (!dishNumber || !groupLabel) return null;

  const [dishes] = await db.query(
    `SELECT id FROM ${Tables.dishes} WHERE number = $number AND deleted_at = none LIMIT 1`,
    {number: dishNumber},
  );
  const dish = dishes?.[0];
  if (!dish) return null;

  const [groups] = await db.query(
    `SELECT id, name FROM ${Tables.modifier_groups} WHERE string::lowercase(name) = string::lowercase($name) LIMIT 1`,
    {name: groupLabel},
  );
  const group = groups?.[0];
  if (!group) return null;

  const [edges] = await db.query(
    `SELECT has_required_modifiers, should_auto_open, required_modifiers, should_auto_select, priority
     FROM ${Tables.dish_modifier_groups} WHERE in = $dish AND out = $group LIMIT 1`,
    {dish: dish.id, group: group.id},
  );
  const edge = edges?.[0];
  if (!edge) return null;

  return {
    dish_number: dishNumber,
    modifier_group: group.name,
    priority: edge.priority,
    has_required_modifiers: edge.has_required_modifiers,
    required_modifiers: edge.required_modifiers,
    should_auto_open: edge.should_auto_open,
    should_auto_select: edge.should_auto_select,
  };
}

export async function fetchExistingModifierGroupOptionRaw(
  db: ImportDbLike,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const groupName = String(patch.group ?? "").trim();
  const modifierLabel = String(patch.modifier ?? "").trim();
  if (!groupName || !modifierLabel) return null;

  const [groups] = await db.query(
    `SELECT id, name, priority, modifiers FROM ${Tables.modifier_groups}
     WHERE string::lowercase(name) = string::lowercase($name) AND deleted_at = none
     FETCH modifiers, modifiers.modifier`,
    {name: groupName},
  );
  const group = groups?.[0];
  if (!group) return null;

  const key = modifierLabel.toLowerCase();
  const option = (group.modifiers ?? []).find((item: any) => {
    const dish = item?.modifier;
    const name = String(dish?.name ?? "").toLowerCase();
    const number = String(dish?.number ?? "").toLowerCase();
    return name === key || number === key || name.includes(key) || key.includes(name);
  });
  if (!option) return null;

  return {
    group: group.name,
    modifier: option.modifier?.name ?? modifierLabel,
    price: option.price,
    priority: group.priority,
  };
}
