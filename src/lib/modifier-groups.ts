import { Tables } from "@/api/db/tables.ts";
import { CartModifierGroup, MenuItem, MenuItemType } from "@/api/model/cart_item.ts";
import { DishModifierGroup } from "@/api/model/dish_modifier_group.ts";
import {
  Modifier,
  ModifierNextGroupOverride,
  ModifierNextGroupOverrideItem,
} from "@/api/model/modifier.ts";
import { ModifierGroup } from "@/api/model/modifier_group.ts";
import {
  MenuModifierOverrides,
  MenuModifierPriceOverride,
  MenuNestedModifierPriceOverride,
} from "@/api/model/menu.ts";
import { toRecordId } from "@/lib/utils.ts";

type DbClient = {
  query: (sql: string, bindings?: Record<string, unknown>) => Promise<unknown>;
};

export function resolveAllowedNextGroupIds(
  allowed?: Array<{ id: unknown } | string> | null
): string[] | undefined {
  if (allowed === null || allowed === undefined) {
    return undefined;
  }

  return allowed.map((item) =>
    typeof item === 'string' ? item : String(item.id)
  );
}

export async function fetchAttachableGroupsForDish(
  db: DbClient,
  dishId: string
): Promise<DishModifierGroup[]> {
  const result = await db.query(
    `SELECT * FROM ${Tables.dish_modifier_groups} WHERE in = $dish ORDER BY priority ASC FETCH out`,
    { dish: toRecordId(dishId) }
  );
  const rows = Array.isArray(result) ? result[0] : result;

  return Array.isArray(rows) ? (rows as DishModifierGroup[]) : [];
}

export async function fetchModifierGroupTemplate(
  db: DbClient,
  groupId: string
): Promise<ModifierGroup | null> {
  const result = await db.query(
    `SELECT * FROM ONLY ${toRecordId(groupId)} FETCH modifiers, modifiers.modifier, modifiers.allowed_next_groups`
  );
  const row = Array.isArray(result) ? result[0] : result;

  return row ?? null;
}

export function normalizeNextGroupOverrides(
  raw?: ModifierNextGroupOverride[] | null
): ModifierNextGroupOverride[] {
  if (!raw?.length) {
    return [];
  }

  return raw.map((entry) => ({
    group_id: toRecordId(entry.group_id as string).toString(),
    items: (entry.items ?? []).map((item) => ({
      nested_modifier_id: toRecordId(item.nested_modifier_id as string).toString(),
      price: Number(item.price),
      hidden: Boolean(item.hidden),
    })),
  }));
}

export function normalizeMenuModifierOverrides(
  raw?: MenuModifierOverrides | null
): MenuModifierOverrides | null {
  if (!raw) {
    return null;
  }

  const prices: MenuModifierPriceOverride[] = (raw.prices ?? [])
    .filter((row) => row?.modifier_id != null && row.price != null && Number.isFinite(Number(row.price)))
    .map((row) => ({
      modifier_id: toRecordId(row.modifier_id as string).toString(),
      price: Number(row.price),
    }));

  const next_group_overrides: MenuNestedModifierPriceOverride[] = (raw.next_group_overrides ?? [])
    .filter((row) => row?.parent_modifier_id && row?.group_id)
    .map((row) => ({
      parent_modifier_id: toRecordId(row.parent_modifier_id as string).toString(),
      group_id: toRecordId(row.group_id as string).toString(),
      items: (row.items ?? [])
        .filter((item) => item?.nested_modifier_id != null && item.price != null && Number.isFinite(Number(item.price)))
        .map((item) => ({
          nested_modifier_id: toRecordId(item.nested_modifier_id as string).toString(),
          price: Number(item.price),
        })),
    }))
    .filter((row) => row.items.length > 0);

  if (prices.length === 0 && next_group_overrides.length === 0) {
    return null;
  }

  return {
    prices: prices.length > 0 ? prices : undefined,
    next_group_overrides: next_group_overrides.length > 0 ? next_group_overrides : undefined,
  };
}

export function isMenuModifierOverridesEmpty(
  overrides?: MenuModifierOverrides | null
): boolean {
  return !normalizeMenuModifierOverrides(overrides);
}

export function getMenuTopLevelPrice(
  overrides: MenuModifierOverrides | null | undefined,
  modifierId: string
): number | undefined {
  const normalizedId = toRecordId(modifierId).toString();
  const match = overrides?.prices?.find(
    (row) => toRecordId(row.modifier_id as string).toString() === normalizedId
  );

  return match != null ? Number(match.price) : undefined;
}

export function getMenuNestedOverrideItems(
  overrides: MenuModifierOverrides | null | undefined,
  parentModifierId: string,
  groupId: string
): Array<{ nested_modifier_id: string; price: number }> | undefined {
  if (!overrides?.next_group_overrides?.length) {
    return undefined;
  }

  const parentId = toRecordId(parentModifierId).toString();
  const normalizedGroupId = toRecordId(groupId).toString();
  const match = overrides.next_group_overrides.find(
    (row) =>
      toRecordId(row.parent_modifier_id as string).toString() === parentId &&
      toRecordId(row.group_id as string).toString() === normalizedGroupId
  );

  return match?.items;
}

export function getOverrideItemsForGroup(
  overrides: ModifierNextGroupOverride[] | undefined,
  groupId: string
): ModifierNextGroupOverrideItem[] | undefined {
  return overrides?.find((o) => o.group_id === groupId)?.items;
}

export function buildOverrideItemsFromTemplate(
  templateModifiers: Modifier[]
): ModifierNextGroupOverrideItem[] {
  return templateModifiers.map((row) => ({
    nested_modifier_id: row.id.toString(),
    price: Number(row.price),
    hidden: false,
  }));
}

export function mergeNextGroupOverrides(
  existing: ModifierNextGroupOverride[] | undefined,
  groupId: string,
  items: ModifierNextGroupOverrideItem[]
): ModifierNextGroupOverride[] {
  const normalized = normalizeNextGroupOverrides(existing);
  const without = normalized.filter((o) => o.group_id !== groupId);

  return [...without, { group_id: groupId, items }];
}

export function applyOverrideToTemplateModifier(
  templateRow: Modifier,
  overrideItems?: ModifierNextGroupOverrideItem[],
  menuPrice?: number
): { price: number; hidden: boolean } {
  const override = overrideItems?.find(
    (item) => item.nested_modifier_id === templateRow.id.toString()
  );

  const basePrice = override?.price ?? Number(templateRow.price);

  return {
    price: menuPrice != null && Number.isFinite(menuPrice) ? menuPrice : basePrice,
    hidden: override?.hidden ?? false,
  };
}

export function buildCatalogMenuItem(
  templateRow: Modifier,
  level: number,
  category: string,
  overrideItems?: ModifierNextGroupOverrideItem[],
  menuPrice?: number
): MenuItem {
  const { price, hidden } = applyOverrideToTemplateModifier(
    templateRow,
    overrideItems,
    menuPrice
  );

  const modifierRecordId = templateRow.id.toString();

  return {
    dish: templateRow.modifier,
    price,
    basePrice: Number(templateRow.price),
    id: modifierRecordId,
    catalogModifierId: modifierRecordId,
    quantity: 1,
    level,
    newOrOld: MenuItemType.new,
    category,
    hidden,
    allowedNextGroupIds: resolveAllowedNextGroupIds(templateRow.allowed_next_groups),
    sourceModifier: templateRow,
  };
}

export function buildOverrideCatalogFromTemplate(
  nestedGroup: ModifierGroup,
  overrideItems?: ModifierNextGroupOverrideItem[],
  level = 0,
  category = ''
): MenuItem[] {
  return (nestedGroup.modifiers ?? []).map((row) =>
    buildCatalogMenuItem(row, level, category, overrideItems)
  );
}

export function buildCartModifierGroups(
  dishGroups: DishModifierGroup[],
  level: number,
  categoryForGroup: (grp: DishModifierGroup) => string,
  parentModifier?: Modifier,
  menuOverrides?: MenuModifierOverrides | null
): CartModifierGroup[] {
  return dishGroups.map((grp) => {
    const groupId = grp.out.id.toString();
    const overrideItems = getOverrideItemsForGroup(
      parentModifier?.next_group_overrides,
      groupId
    );
    const menuNestedItems = parentModifier
      ? getMenuNestedOverrideItems(
          menuOverrides,
          parentModifier.id.toString(),
          groupId
        )
      : undefined;

    const hasMenuPrices = parentModifier
      ? Boolean(menuNestedItems?.length)
      : Boolean(menuOverrides?.prices?.length);

    return {
      ...grp,
      selectedModifiers: [],
      catalogCustomized: Boolean(overrideItems?.length) || hasMenuPrices,
      modifiers: (grp.out.modifiers ?? []).map((row) => {
        const modifierId = row.id.toString();
        const menuPrice = parentModifier
          ? menuNestedItems?.find(
              (item) =>
                toRecordId(item.nested_modifier_id as string).toString() ===
                modifierId
            )?.price
          : getMenuTopLevelPrice(menuOverrides, modifierId);

        return buildCatalogMenuItem(
          row,
          level,
          categoryForGroup(grp),
          overrideItems,
          menuPrice
        );
      }),
    };
  });
}

export function buildCartModifierGroupsWithOverrides(
  dishGroups: DishModifierGroup[],
  parentModifier: Modifier | undefined,
  level: number,
  categoryForGroup: (grp: DishModifierGroup) => string,
  menuOverrides?: MenuModifierOverrides | null
): CartModifierGroup[] {
  return buildCartModifierGroups(
    dishGroups,
    level,
    categoryForGroup,
    parentModifier,
    menuOverrides
  );
}

export function buildNestedGroupsForModifier(
  modifierDishId: string,
  allowedNextGroupIds: string[] | undefined,
  groupsDishes: DishModifierGroup[],
  level: number,
  categoryForGroup: (grp: DishModifierGroup) => string,
  parentModifier?: Modifier,
  menuOverrides?: MenuModifierOverrides | null
): CartModifierGroup[] {
  const allGroups = groupsDishes.filter(
    (row) => row.in.id.toString() === modifierDishId.toString()
  );

  const filtered =
    allowedNextGroupIds === undefined
      ? allGroups
      : allGroups.filter((g) =>
          allowedNextGroupIds.includes(g.out.id.toString())
        );

  return buildCartModifierGroups(
    filtered,
    level,
    categoryForGroup,
    parentModifier,
    menuOverrides
  );
}

export function cloneCartModifierGroups(
  groups: CartModifierGroup[]
): CartModifierGroup[] {
  return groups.map((grp) => ({
    ...grp,
    selectedModifiers: [...(grp.selectedModifiers ?? [])].map((selected) => ({
      ...selected,
      catalogModifierId:
        selected.catalogModifierId ??
        selected.sourceModifier?.id?.toString(),
      selectedGroups: selected.selectedGroups
        ? cloneCartModifierGroups(selected.selectedGroups)
        : undefined,
    })),
    modifiers: (grp.modifiers ?? []).map((catalog) => ({
      ...catalog,
      basePrice: catalog.basePrice ?? catalog.price,
      hidden: catalog.hidden ?? false,
      selectedGroups: catalog.selectedGroups
        ? cloneCartModifierGroups(catalog.selectedGroups)
        : undefined,
    })),
  }));
}

export function updateModifierNestedGroups(
  groups: CartModifierGroup[],
  modifierId: string,
  nestedGroups: CartModifierGroup[]
): CartModifierGroup[] {
  return groups.map((grp) => ({
    ...grp,
    selectedModifiers: (grp.selectedModifiers ?? []).map((selected) =>
      selected.id === modifierId
        ? {
            ...selected,
            selectedGroups: cloneCartModifierGroups(nestedGroups),
          }
        : selected
    ),
  }));
}

export function getVisibleCatalogModifiers(group: CartModifierGroup): MenuItem[] {
  return (group.modifiers ?? []).filter((m) => !m.hidden);
}

/** Unique key for a dish↔modifier_group attachment (edge id), not the template group id. */
export function getGroupInstanceKey(
  grp: DishModifierGroup | CartModifierGroup
): string {
  return grp.id.toString();
}

export function isSameGroupInstance(
  a: DishModifierGroup | CartModifierGroup,
  b: DishModifierGroup | CartModifierGroup
): boolean {
  return getGroupInstanceKey(a) === getGroupInstanceKey(b);
}

/** Sidebar label; adds (2), (3) when the same modifier group is attached multiple times. */
export function getGroupSidebarLabel(
  grp: CartModifierGroup,
  allGroups: CartModifierGroup[]
): string {
  const templateId = grp.out.id.toString();
  const instances = allGroups.filter(
    (g) => g.out.id.toString() === templateId
  );

  if (instances.length <= 1) {
    return grp.out.name;
  }

  const instanceNumber =
    instances.findIndex((g) => isSameGroupInstance(g, grp)) + 1;

  return `${grp.out.name} (${instanceNumber})`;
}

/** Stable key for a catalog or selected modifier line (modifier record id, not dish id). */
export function getCatalogModifierKey(item: MenuItem): string {
  return (
    item.catalogModifierId ??
    item.sourceModifier?.id?.toString() ??
    item.id.toString()
  );
}

export function isCatalogModifierSelected(
  group: CartModifierGroup,
  catalogModifier: MenuItem
): boolean {
  const catalogKey = getCatalogModifierKey(catalogModifier);

  return (group.selectedModifiers ?? []).some(
    (selected) => getCatalogModifierKey(selected) === catalogKey
  );
}

export function syncSelectedModifierPrices(
  group: CartModifierGroup
): CartModifierGroup {
  const catalogByModifierId = new Map(
    (group.modifiers ?? []).map((m) => [getCatalogModifierKey(m), m])
  );

  return applyIncludedModifierPricing({
    ...group,
    catalogCustomized: true,
    selectedModifiers: (group.selectedModifiers ?? []).map((selected) => {
      const catalog = catalogByModifierId.get(getCatalogModifierKey(selected));
      if (!catalog) {
        return selected;
      }

      return {
        ...selected,
        price: catalog.price,
        listPrice: catalog.price,
      };
    }),
  });
}

export function resetCartModifierGroupCatalog(
  group: CartModifierGroup
): CartModifierGroup {
  const templateByModifierId = new Map(
    (group.out.modifiers ?? []).map((m) => [m.id?.toString(), m])
  );
  const templateByDishId = new Map(
    (group.out.modifiers ?? []).map((m) => [m.modifier.id.toString(), m])
  );

  const resetModifiers = (group.modifiers ?? []).map((catalog) => {
    const template =
      templateByModifierId.get(getCatalogModifierKey(catalog)) ??
      templateByDishId.get(catalog.dish.id.toString());
    const basePrice = template?.price ?? catalog.basePrice ?? catalog.price;

    return {
      ...catalog,
      price: basePrice,
      basePrice,
      hidden: false,
    };
  });

  return syncSelectedModifierPrices({
    ...group,
    catalogCustomized: false,
    modifiers: resetModifiers,
  });
}

export function resolveGroupInList(
  groups: CartModifierGroup[],
  group: CartModifierGroup
): CartModifierGroup {
  return groups.find((g) => isSameGroupInstance(g, group)) ?? group;
}

const positiveInt = (value: unknown): number => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The dish gives some choices of this group free and charges the next ones. */
export function hasIncludedModifiers(grp: DishModifierGroup): boolean {
  return positiveInt(grp.included_modifiers) > 0;
}

/** The most choices the group takes, or undefined for no limit. */
export function getGroupMaxModifiers(grp: DishModifierGroup): number | undefined {
  if (hasIncludedModifiers(grp)) {
    const max = positiveInt(grp.max_modifiers);
    return max > 0 ? max : undefined;
  }

  return grp.has_required_modifiers ? (grp.required_modifiers ?? 0) : undefined;
}

/**
 * Choices after which the group is done: the picker moves on, and closes once every group is.
 * A group with included choices is done at its free count (more can still be added, charged).
 */
export function getGroupFillTarget(grp: DishModifierGroup): number {
  const required = grp.has_required_modifiers ? positiveInt(grp.required_modifiers) : 0;

  if (!hasIncludedModifiers(grp)) {
    return required;
  }

  const target = Math.max(required, positiveInt(grp.included_modifiers));
  const max = getGroupMaxModifiers(grp);

  return max !== undefined ? Math.min(target, max) : target;
}

/**
 * The group takes more choices than its fill target (sides: 1 included, no limit), so the
 * server may add a second side, or the same one twice: the picker waits for "Confirm"
 * instead of closing on the first pick.
 */
export function isOpenEndedGroup(grp: DishModifierGroup): boolean {
  if (!hasIncludedModifiers(grp)) {
    return false;
  }
  const max = getGroupMaxModifiers(grp);
  return max === undefined || max > getGroupFillTarget(grp);
}

export function isGroupFilled(grp: CartModifierGroup): boolean {
  return (grp.selectedModifiers?.length ?? 0) >= getGroupFillTarget(grp);
}

/** Neither required nor with included choices: never closes the picker by itself. */
export function isOptionalGroup(grp: DishModifierGroup): boolean {
  return !grp.has_required_modifiers && !hasIncludedModifiers(grp);
}

const finiteOrUndefined = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Prices a group's choices from the dish's included count: the free ones go to 0, the rest
 * cost the group's extra price, else their own. Which ones are free follows the group's rule.
 * A group without included choices is returned untouched.
 */
export function applyIncludedModifierPricing(grp: CartModifierGroup): CartModifierGroup {
  if (!hasIncludedModifiers(grp)) {
    return grp;
  }

  const selected = grp.selectedModifiers ?? [];
  const included = positiveInt(grp.included_modifiers);
  const fixedPrice = finiteOrUndefined(grp.out?.extra_modifier_price);
  const charges = selected.map((modifier) =>
    fixedPrice ?? finiteOrUndefined(modifier.listPrice) ?? finiteOrUndefined(modifier.price) ?? 0
  );

  const order = selected.map((_, index) => index);
  const rule = grp.out?.free_modifier_rule;
  if (rule === 'cheapest') {
    order.sort((a, b) => charges[a] - charges[b] || a - b);
  } else if (rule === 'most_expensive') {
    order.sort((a, b) => charges[b] - charges[a] || a - b);
  }
  const free = new Set(order.slice(0, included));

  return {
    ...grp,
    selectedModifiers: selected.map((modifier, index) => ({
      ...modifier,
      listPrice: finiteOrUndefined(modifier.listPrice) ?? finiteOrUndefined(modifier.price) ?? 0,
      price: free.has(index) ? 0 : charges[index],
      includedModifier: free.has(index),
    })),
  };
}

export function shouldAdvanceFromGroup(grp: CartModifierGroup): boolean {
  return (
    isGroupFilled(grp) ||
    (Boolean(grp.should_auto_open) && isOptionalGroup(grp))
  );
}

export function findNextActiveGroup(
  groups: CartModifierGroup[],
  current: CartModifierGroup
): CartModifierGroup | undefined {
  const isNotCurrent = (item: CartModifierGroup) =>
    !isSameGroupInstance(item, current);

  const incompleteRequired = groups.find(
    (item) =>
      isNotCurrent(item) &&
      item.has_required_modifiers &&
      (item.selectedModifiers?.length ?? 0) < (item.required_modifiers ?? 0)
  );

  if (incompleteRequired) {
    return incompleteRequired;
  }

  const unfilledIncluded = groups.find(
    (item) => isNotCurrent(item) && hasIncludedModifiers(item) && !isGroupFilled(item)
  );

  if (unfilledIncluded) {
    return unfilledIncluded;
  }

  return groups.find(
    (item) =>
      isNotCurrent(item) &&
      Boolean(item.should_auto_open) &&
      isOptionalGroup(item)
  );
}

export function validateNestedGroupsVisibility(
  groups: CartModifierGroup[]
): string | null {
  for (const grp of groups) {
    if (!grp.has_required_modifiers) {
      continue;
    }

    const visibleCount = getVisibleCatalogModifiers(grp).length;
    const required = grp.required_modifiers ?? 0;

    if (visibleCount < required) {
      return `"${grp.out.name}" needs at least ${required} visible options, but only ${visibleCount} are shown.`;
    }
  }

  return null;
}
