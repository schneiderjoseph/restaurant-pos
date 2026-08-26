'use strict';

const { queryRows, recordIdString, asRecord } = require('./surreal');

const LOYVERSE_MENU_ID = 'menu:loyverse_catalog';
const LOYVERSE_MENU_NAME = 'Loyverse';

/** Stable Surreal id for a Loyverse tax UUID */
function loyverseTaxRecordId(loyverseId) {
  const key = String(loyverseId).replace(/-/g, '');
  return `tax:loyverse_${key}`;
}

/**
 * Upsert Loyverse taxes only — does not soft-delete native/ASI taxes.
 * @returns {Map<string, string>} loyverse tax id → Surreal tax record id
 */
async function ensureLoyverseTaxes(db, taxes) {
  /** @type {Map<string, string>} */
  const idMap = new Map();
  const keep = new Set();

  for (const t of taxes) {
    if (!t.loyverseId || !(t.rate > 0)) continue;
    const id = loyverseTaxRecordId(t.loyverseId);
    keep.add(id);
    const existing = await queryRows(db, `SELECT id FROM ${id}`);
    if (existing[0]?.id) {
      await queryRows(
        db,
        `UPDATE ${id} SET
          name = $name,
          rate = $rate,
          priority = $priority,
          source = 'loyverse',
          loyverse_id = $loyverseId,
          deleted_at = NONE`,
        {
          name: t.name,
          rate: t.rate,
          priority: t.priority,
          loyverseId: t.loyverseId,
        },
      );
    } else {
      await queryRows(
        db,
        `CREATE ${id} SET
          name = $name,
          rate = $rate,
          priority = $priority,
          source = 'loyverse',
          loyverse_id = $loyverseId,
          deleted_at = NONE`,
        {
          name: t.name,
          rate: t.rate,
          priority: t.priority,
          loyverseId: t.loyverseId,
        },
      );
    }
    idMap.set(t.loyverseId, id);
  }

  // Soft-delete Loyverse taxes no longer present (leave other sources alone)
  const existingLv = await queryRows(
    db,
    `SELECT id FROM tax
     WHERE source = 'loyverse'
       AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  for (const row of existingLv) {
    const rid = recordIdString(row.id);
    if (!keep.has(rid)) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
        id: asRecord(rid),
      });
    }
  }

  return idMap;
}

async function upsertCategory(db, cat) {
  let found = await queryRows(
    db,
    `SELECT id FROM category
     WHERE loyverse_id = $lid
       AND (deleted_at = NONE OR deleted_at = NULL)
     LIMIT 1`,
    { lid: cat.loyverseId },
  );
  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM category WHERE loyverse_id = $lid ORDER BY id ASC LIMIT 1`,
      { lid: cat.loyverseId },
    );
  }

  const payload = {
    name: cat.name,
    priority: cat.priority,
    show_in_menu: !cat.deleted,
    color: cat.color || null,
    source: 'loyverse',
    loyverse_id: cat.loyverseId,
  };

  if (found[0]?.id) {
    if (cat.deleted) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now(), source = 'loyverse', loyverse_id = $lid`, {
        id: asRecord(found[0].id),
        lid: cat.loyverseId,
      });
      return recordIdString(found[0].id);
    }
    await queryRows(
      db,
      `UPDATE $id SET
        name = $name,
        priority = $priority,
        show_in_menu = $show_in_menu,
        color = $color,
        source = $source,
        loyverse_id = $loyverse_id,
        deleted_at = NONE`,
      { id: asRecord(found[0].id), ...payload },
    );
    return recordIdString(found[0].id);
  }

  if (cat.deleted) return null;

  const created = await queryRows(
    db,
    `CREATE category SET
      name = $name,
      priority = $priority,
      show_in_menu = $show_in_menu,
      color = $color,
      source = $source,
      loyverse_id = $loyverse_id,
      deleted_at = NONE`,
    payload,
  );
  if (!created[0]?.id) {
    throw new Error(`Failed to create category for Loyverse ${cat.loyverseId}`);
  }
  return recordIdString(created[0].id);
}

async function upsertDish(db, variant, categoryId) {
  let found = await queryRows(
    db,
    `SELECT id FROM menu_item
     WHERE loyverse_variant_id = $vid
       AND (deleted_at = NONE OR deleted_at = NULL)
     LIMIT 1`,
    { vid: variant.loyverseVariantId },
  );
  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM menu_item WHERE loyverse_variant_id = $vid ORDER BY id ASC LIMIT 1`,
      { vid: variant.loyverseVariantId },
    );
  }
  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM menu_item WHERE number = $plu AND source = 'loyverse' LIMIT 1`,
      { plu: variant.number },
    );
  }

  const categories = categoryId ? [asRecord(categoryId)] : [];

  if (found[0]?.id) {
    if (variant.deleted || !variant.available) {
      await queryRows(
        db,
        `UPDATE $id SET
          deleted_at = time::now(),
          source = 'loyverse',
          loyverse_id = $loyverse_id,
          loyverse_variant_id = $loyverse_variant_id`,
        {
          id: asRecord(found[0].id),
          loyverse_id: variant.loyverseItemId,
          loyverse_variant_id: variant.loyverseVariantId,
        },
      );
      return recordIdString(found[0].id);
    }
    await queryRows(
      db,
      `UPDATE $id SET
        name = $name,
        number = $plu,
        price = $price,
        cost = $cost,
        categories = $categories,
        priority = $priority,
        source = 'loyverse',
        loyverse_id = $loyverse_id,
        loyverse_variant_id = $loyverse_variant_id,
        deleted_at = NONE`,
      {
        id: asRecord(found[0].id),
        name: variant.name,
        plu: variant.number,
        price: variant.price,
        cost: variant.cost,
        categories,
        priority: 0,
        loyverse_id: variant.loyverseItemId,
        loyverse_variant_id: variant.loyverseVariantId,
      },
    );
    return recordIdString(found[0].id);
  }

  if (variant.deleted || !variant.available) return null;

  const created = await queryRows(
    db,
    `CREATE menu_item SET
      name = $name,
      number = $plu,
      price = $price,
      cost = $cost,
      categories = $categories,
      priority = $priority,
      source = 'loyverse',
      loyverse_id = $loyverse_id,
      loyverse_variant_id = $loyverse_variant_id,
      deleted_at = NONE`,
    {
      name: variant.name,
      plu: variant.number,
      price: variant.price,
      cost: variant.cost,
      categories,
      priority: 0,
      loyverse_id: variant.loyverseItemId,
      loyverse_variant_id: variant.loyverseVariantId,
    },
  );
  if (!created[0]?.id) {
    throw new Error(`Failed to create menu_item for variant ${variant.loyverseVariantId}`);
  }
  return recordIdString(created[0].id);
}

async function softDeleteMissingLoyverseDishes(db, activeVariantIds) {
  const active = new Set(activeVariantIds.map(String));
  const existing = await queryRows(
    db,
    `SELECT id, loyverse_variant_id FROM menu_item
     WHERE source = 'loyverse'
       AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  let deactivated = 0;
  for (const row of existing) {
    const vid = String(row.loyverse_variant_id || '');
    if (!active.has(vid)) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
        id: asRecord(row.id),
      });
      deactivated += 1;
    }
  }
  return deactivated;
}

/**
 * POSR Menu UI only shows dishes linked through an active selected menu.
 */
async function ensureLoyverseMenu(db, dishEntries) {
  const existing = await queryRows(db, `SELECT id, items FROM ${LOYVERSE_MENU_ID}`);
  if (!existing[0]?.id) {
    await queryRows(
      db,
      `CREATE ${LOYVERSE_MENU_ID} SET
        name = $name,
        active = true,
        items = [],
        deleted_at = NONE`,
      { name: LOYVERSE_MENU_NAME },
    );
  } else {
    await queryRows(
      db,
      `UPDATE ${LOYVERSE_MENU_ID} SET name = $name, active = true, deleted_at = NONE`,
      { name: LOYVERSE_MENU_NAME },
    );
  }

  const prev = await queryRows(db, `SELECT items FROM ${LOYVERSE_MENU_ID}`);
  const prevItems = Array.isArray(prev[0]?.items) ? prev[0].items : [];
  for (const mid of prevItems) {
    try {
      await queryRows(db, `DELETE $id`, { id: asRecord(mid) });
    } catch {
      // ignore missing
    }
  }

  const itemRefs = [];
  for (const entry of dishEntries) {
    const dishId = typeof entry === 'string' ? entry : entry.id;
    const taxIds = Array.isArray(entry?.taxIds) ? entry.taxIds : [];
    // Loyverse ADDED taxes ≈ exclusive in POSR
    const created = await queryRows(
      db,
      `CREATE menu_menu_item SET
        menu_item = $dish,
        active = true,
        tax_mode = 'exclusive',
        taxes = $taxList,
        tax = $primaryTax`,
      {
        dish: asRecord(dishId),
        taxList: taxIds.map(asRecord),
        primaryTax: taxIds[0] ? asRecord(taxIds[0]) : null,
      },
    );
    if (created[0]?.id) {
      itemRefs.push(asRecord(created[0].id));
    }
  }

  await queryRows(db, `UPDATE ${LOYVERSE_MENU_ID} SET items = $items`, { items: itemRefs });

  const settings = await queryRows(
    db,
    `SELECT id, values FROM setting WHERE key = 'menus' AND is_global = true LIMIT 1`,
  );
  const menuRef = asRecord(LOYVERSE_MENU_ID);
  if (settings[0]?.id) {
    await queryRows(db, `UPDATE $id SET values = [$menu]`, {
      id: asRecord(settings[0].id),
      menu: menuRef,
    });
  } else {
    await queryRows(
      db,
      `CREATE setting SET key = 'menus', is_global = true, values = [$menu]`,
      { menu: menuRef },
    );
  }

  return itemRefs.length;
}

async function reviveLoyverseRecords(db, dishIds, categoryIds) {
  const chunkSize = 40;
  for (let i = 0; i < dishIds.length; i += chunkSize) {
    const chunk = dishIds.slice(i, i + chunkSize);
    await queryRows(db, `UPDATE menu_item SET deleted_at = NONE WHERE id INSIDE $ids`, {
      ids: chunk.map(asRecord),
    });
  }
  for (let i = 0; i < categoryIds.length; i += chunkSize) {
    const chunk = categoryIds.slice(i, i + chunkSize);
    await queryRows(db, `UPDATE category SET deleted_at = NONE WHERE id INSIDE $ids`, {
      ids: chunk.map(asRecord),
    });
  }
}

/**
 * @param {import('surrealdb').Surreal} db
 * @param {Awaited<ReturnType<typeof import('./loyverse-query').fetchLoyverseCatalog>>} catalog
 */
async function upsertCatalog(db, catalog) {
  /** @type {Map<string, string>} */
  const catMap = new Map();
  /** @type {string[]} */
  const categoryIds = [];
  let categoryCount = 0;

  for (const c of catalog.categories) {
    const id = await upsertCategory(db, c);
    if (id) {
      catMap.set(c.loyverseId, id);
      if (!c.deleted) {
        categoryIds.push(id);
        categoryCount += 1;
      }
    }
  }

  const taxMap = await ensureLoyverseTaxes(db, catalog.taxes);

  /** @type {{ id: string, taxIds: string[] }[]} */
  const dishEntries = [];
  /** @type {string[]} */
  const allDishIds = [];
  /** @type {string[]} */
  const activeVariantIds = [];
  let itemCount = 0;

  for (const v of catalog.variants) {
    if (!v.deleted && v.available) {
      activeVariantIds.push(v.loyverseVariantId);
    }
    const categoryId = v.categoryId ? catMap.get(v.categoryId) || null : null;
    // Ensure orphan category placeholder if item points to unknown category
    let resolvedCat = categoryId;
    if (v.categoryId && !resolvedCat && !v.deleted) {
      resolvedCat = await upsertCategory(db, {
        loyverseId: v.categoryId,
        name: 'Loyverse',
        color: null,
        deleted: false,
        priority: 9990,
      });
      if (resolvedCat) {
        catMap.set(v.categoryId, resolvedCat);
        categoryIds.push(resolvedCat);
      }
    }

    const dishId = await upsertDish(db, v, resolvedCat);
    if (!dishId) continue;
    if (!v.deleted && v.available) {
      allDishIds.push(dishId);
      const taxIds = (v.taxIds || []).map((tid) => taxMap.get(tid)).filter(Boolean);
      dishEntries.push({ id: dishId, taxIds: [...new Set(taxIds)] });
      itemCount += 1;
    }
  }

  const deactivated = await softDeleteMissingLoyverseDishes(db, activeVariantIds);
  const menuItems = await ensureLoyverseMenu(db, dishEntries);
  await reviveLoyverseRecords(db, allDishIds, categoryIds.filter(Boolean));

  return {
    categories: categoryCount,
    items: itemCount,
    taxes: taxMap.size,
    deactivated,
    menuItems,
    storeId: catalog.storeId,
  };
}

module.exports = {
  upsertCatalog,
  LOYVERSE_MENU_ID,
};
