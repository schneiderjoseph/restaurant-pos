'use strict';

const { queryRows, recordIdString, asRecord } = require('./surreal');

const ASI_MENU_ID = 'menu:asi_restaurant';
const ASI_MENU_NAME = 'Restaurant (ASI)';

/** Stable Surreal id for an ASI rate, e.g. 10 → tax:asi_10, 2.5 → tax:asi_2_5 */
function asiTaxRecordId(rate) {
  const key = String(rate).replace(/\./g, '_');
  return `tax:asi_${key}`;
}

/**
 * Upsert one POSR tax row per distinct ASI rate; soft-delete demo GST so the
 * cart no longer shows "Total with GST 5%/17%".
 * @returns {Map<number, string>} rate → tax record id
 */
async function ensureAsiTaxes(db, activeItems) {
  /** @type {Map<number, { rate: number, slot: number, name: string }>} */
  const byRate = new Map();
  for (const item of activeItems) {
    for (const t of item.taxes || []) {
      const rate = Number(t.rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      const slot = Number(t.slot) || 99;
      const name = String(t.label || '').trim() || `Tax ${slot}`;
      const prev = byRate.get(rate);
      // Prefer lower ASI slot so rate 10 → TCA (slot 1), not a later slot
      if (!prev || slot < prev.slot) {
        byRate.set(rate, { rate, slot, name });
      }
    }
  }

  // Soft-delete every non-ASI tax (demo GST 5%/17%, etc.) — ASI rates are tax:asi_*
  await queryRows(
    db,
    `UPDATE tax SET deleted_at = time::now()
     WHERE deleted_at = NONE
       AND !string::starts_with(type::string(id), 'tax:asi_')`,
  );

  /** @type {Map<number, string>} */
  const rateToId = new Map();
  for (const { rate, slot, name } of byRate.values()) {
    const id = asiTaxRecordId(rate);
    const existing = await queryRows(db, `SELECT id FROM ${id}`);
    if (existing[0]?.id) {
      await queryRows(
        db,
        `UPDATE ${id} SET name = $name, rate = $rate, priority = $priority, deleted_at = NONE`,
        { name, rate, priority: slot },
      );
    } else {
      await queryRows(
        db,
        `CREATE ${id} SET name = $name, rate = $rate, priority = $priority, deleted_at = NONE`,
        { name, rate, priority: slot },
      );
    }
    rateToId.set(rate, id);
  }
  return rateToId;
}

async function clearDeletedAt(db, id) {
  // IMPORTANT: never MERGE deleted_at: null — Surreal stores NULL, and POSR
  // filters `deleted_at = NONE`, so those rows disappear from the menu cache.
  await queryRows(db, `UPDATE $id SET deleted_at = NONE`, { id: asRecord(id) });
}

/** Bulk-revive ASI rows so POSR `deleted_at = none` filters see them. */
async function reviveAsiRecords(db, dishIds, categoryIds) {
  const chunkSize = 40;
  for (let i = 0; i < dishIds.length; i += chunkSize) {
    const chunk = dishIds.slice(i, i + chunkSize);
    await queryRows(
      db,
      `UPDATE menu_item SET deleted_at = NONE WHERE id INSIDE $ids`,
      { ids: chunk.map(asRecord) },
    );
  }
  for (let i = 0; i < categoryIds.length; i += chunkSize) {
    const chunk = categoryIds.slice(i, i + chunkSize);
    await queryRows(
      db,
      `UPDATE category SET deleted_at = NONE WHERE id INSIDE $ids`,
      { ids: chunk.map(asRecord) },
    );
  }
}

/** Drop leftover ASI-{id} PLUs when an alias row exists for the same asi_item_id. */
async function softDeleteLegacyAsiPluDupes(db) {
  const legacy = await queryRows(
    db,
    `SELECT id, asi_item_id, number FROM menu_item
     WHERE source = 'asi'
       AND string::starts_with(number, 'ASI-')
       AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  let n = 0;
  for (const row of legacy) {
    const asiItemId = row.asi_item_id != null ? Number(row.asi_item_id) : null;
    if (!Number.isFinite(asiItemId)) continue;
    const siblings = await queryRows(
      db,
      `SELECT id FROM menu_item
       WHERE source = 'asi'
         AND asi_item_id = $asiItemId
         AND id != $id
         AND !string::starts_with(number, 'ASI-')
         AND (deleted_at = NONE OR deleted_at = NULL)
       LIMIT 1`,
      { asiItemId, id: asRecord(row.id) },
    );
    if (!siblings[0]?.id) continue;
    await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
      id: asRecord(row.id),
    });
    n += 1;
  }
  return n;
}

async function upsertCategory(db, group, priority) {
  // Treat JS null and Surreal NONE as "alive" — merge(null) previously broke NONE checks.
  let found = await queryRows(
    db,
    `SELECT id FROM category
     WHERE asi_group_id = $gid
       AND (deleted_at = NONE OR deleted_at = NULL)
     LIMIT 1`,
    { gid: group.asiGroupId },
  );

  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM category
       WHERE asi_group_id = $gid
       ORDER BY id ASC
       LIMIT 1`,
      { gid: group.asiGroupId },
    );
  }

  if (!found[0]?.id && group.name) {
    found = await queryRows(
      db,
      `SELECT id FROM category
       WHERE name = $name
         AND (source = 'asi' OR source = NONE OR source = NULL)
         AND (deleted_at = NONE OR deleted_at = NULL)
       LIMIT 1`,
      { name: group.name },
    );
  }

  const payload = {
    name: group.name,
    priority,
    show_in_menu: !!group.isActive,
    source: 'asi',
    asi_group_id: group.asiGroupId,
    asi_alias: group.alias || null,
  };

  if (found[0]?.id) {
    await queryRows(
      db,
      `UPDATE $id SET
        name = $name,
        priority = $priority,
        show_in_menu = $show_in_menu,
        source = $source,
        asi_group_id = $asi_group_id,
        asi_alias = $asi_alias,
        deleted_at = NONE`,
      { id: asRecord(found[0].id), ...payload },
    );
    return recordIdString(found[0].id);
  }

  const created = await queryRows(
    db,
    `CREATE category SET
      name = $name,
      priority = $priority,
      show_in_menu = $show_in_menu,
      source = $source,
      asi_group_id = $asi_group_id,
      asi_alias = $asi_alias,
      deleted_at = NONE`,
    payload,
  );
  if (!created[0]?.id) {
    throw new Error(`Failed to create category for ASI group ${group.asiGroupId}`);
  }
  return recordIdString(created[0].id);
}

async function upsertDish(db, item, categoryId) {
  // Prefer alive non-legacy PLU when duplicates exist for the same ASI id
  let found = await queryRows(
    db,
    `SELECT id, number FROM menu_item
     WHERE asi_item_id = $asiItemId
       AND (deleted_at = NONE OR deleted_at = NULL)`,
    { asiItemId: item.asiItemId },
  );
  if (found.length > 1) {
    found = [
      ...found.filter((r) => !String(r.number || '').startsWith('ASI-')),
      ...found.filter((r) => String(r.number || '').startsWith('ASI-')),
    ];
  }
  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM menu_item WHERE asi_item_id = $asiItemId ORDER BY id ASC LIMIT 1`,
      { asiItemId: item.asiItemId },
    );
  }
  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM menu_item WHERE number = $plu LIMIT 1`,
      { plu: item.number },
    );
  }
  // Legacy upsert key ASI-{id}
  if (!found[0]?.id) {
    found = await queryRows(
      db,
      `SELECT id FROM menu_item WHERE number = $legacy LIMIT 1`,
      { legacy: `ASI-${item.asiItemId}` },
    );
  }

  const payload = {
    name: item.name,
    plu: item.number,
    price: item.price,
    cost: null,
    categories: [asRecord(categoryId)],
    priority: item.asiItemId,
    source: 'asi',
    asi_item_id: item.asiItemId,
    asi_alias: item.alias || null,
  };

  if (found[0]?.id) {
    await queryRows(
      db,
      `UPDATE $id SET
        name = $name,
        number = $plu,
        price = $price,
        categories = [$category],
        priority = $priority,
        source = $source,
        asi_item_id = $asi_item_id,
        asi_alias = $asi_alias,
        deleted_at = NONE`,
      {
        id: asRecord(found[0].id),
        name: payload.name,
        plu: payload.plu,
        price: payload.price,
        category: asRecord(categoryId),
        priority: payload.priority,
        source: payload.source,
        asi_item_id: payload.asi_item_id,
        asi_alias: payload.asi_alias,
      },
    );
    const keepId = recordIdString(found[0].id);
    await softDeleteAsiDishDupes(db, keepId, item.asiItemId);
    return keepId;
  }

  const created = await queryRows(
    db,
    `CREATE menu_item SET
      name = $name,
      number = $plu,
      price = $price,
      categories = [$category],
      priority = $priority,
      source = $source,
      asi_item_id = $asi_item_id,
      asi_alias = $asi_alias,
      deleted_at = NONE`,
    {
      name: payload.name,
      plu: payload.plu,
      price: payload.price,
      category: asRecord(categoryId),
      priority: payload.priority,
      source: payload.source,
      asi_item_id: payload.asi_item_id,
      asi_alias: payload.asi_alias,
    },
  );
  if (!created[0]?.id) {
    throw new Error(`Failed to create menu_item ${item.number}`);
  }
  const keepId = recordIdString(created[0].id);
  await softDeleteAsiDishDupes(db, keepId, item.asiItemId);
  return keepId;
}

/** Remove legacy ASI-{id} duplicates once the canonical alias PLU exists. */
async function softDeleteAsiDishDupes(db, keepId, asiItemId) {
  const dupes = await queryRows(
    db,
    `SELECT id FROM menu_item
     WHERE source = 'asi'
       AND asi_item_id = $asiItemId
       AND id != $keepId
       AND (deleted_at = NONE OR deleted_at = NULL)`,
    { asiItemId, keepId: asRecord(keepId) },
  );
  for (const row of dupes) {
    await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
      id: asRecord(row.id),
    });
  }
  // Also catch legacy rows that never got asi_item_id
  const legacy = await queryRows(
    db,
    `SELECT id FROM menu_item
     WHERE source = 'asi'
       AND number = $legacy
       AND id != $keepId
       AND (deleted_at = NONE OR deleted_at = NULL)`,
    { legacy: `ASI-${asiItemId}`, keepId: asRecord(keepId) },
  );
  for (const row of legacy) {
    await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
      id: asRecord(row.id),
    });
  }
}

async function softDeleteMissingAsiDishes(db, activeAsiItemIds) {
  const active = new Set(activeAsiItemIds.map(Number));
  const existing = await queryRows(
    db,
    `SELECT id, asi_item_id, number FROM menu_item
     WHERE source = 'asi'
       AND (deleted_at = NONE OR deleted_at = NULL)`,
  );

  let deactivated = 0;
  for (const row of existing) {
    const asiId = Number(row.asi_item_id);
    const legacyMatch = String(row.number || '').match(/^ASI-(\d+)$/);
    const id = Number.isFinite(asiId) ? asiId : Number(legacyMatch?.[1]);
    if (!active.has(id)) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
        id: asRecord(row.id),
      });
      deactivated += 1;
    }
  }
  return deactivated;
}

/**
 * Soft-delete duplicate ASI categories, keep the canonical id per asi_group_id.
 */
async function dedupeAsiCategories(db, keepIds) {
  const keep = new Set(keepIds);
  const rows = await queryRows(
    db,
    `SELECT id, asi_group_id FROM category WHERE source = 'asi'`,
  );
  let n = 0;
  for (const row of rows) {
    const id = recordIdString(row.id);
    if (!keep.has(id)) {
      await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
        id: asRecord(id),
      });
      n += 1;
    }
  }
  return n;
}

/**
 * Resolve the POSR kitchen board for an ASI station.
 * Prefer live tagged boards, then revive soft-deleted CUISINE/BAR by name.
 * Never uses / creates kitchen:station_* boards.
 */
async function resolveKitchenForStation(db, station) {
  const isLegacyId = (id) => {
    const s = recordIdString(id);
    return s.includes('station_cuisine') || s.includes('station_bar');
  };

  const tagged = await queryRows(
    db,
    `SELECT id, items, priority, name FROM kitchen
     WHERE station = $station
       AND (deleted_at = NONE OR deleted_at = NULL)
     ORDER BY priority ASC`,
    { station },
  );
  const taggedLive = tagged.find((row) => row?.id && !isLegacyId(row.id));
  if (taggedLive) {
    return taggedLive;
  }

  const names =
    station === 'bar'
      ? ['BAR', 'Bar', 'bar']
      : ['CUISINE', 'Cuisine', 'cuisine', 'KITCHEN', 'Kitchen'];

  const live = await queryRows(
    db,
    `SELECT id, items, priority, name FROM kitchen
     WHERE name IN $names
       AND (deleted_at = NONE OR deleted_at = NULL)
     ORDER BY priority ASC`,
    { names },
  );
  const livePreferred = live.find((row) => row?.id && !isLegacyId(row.id));
  if (livePreferred?.id) {
    await queryRows(db, `UPDATE $id SET station = $station, deleted_at = NONE`, {
      id: asRecord(livePreferred.id),
      station,
    });
    return livePreferred;
  }

  // Revive soft-deleted user board (e.g. accidentally deleted in Manage)
  const soft = await queryRows(
    db,
    `SELECT id, items, priority, name FROM kitchen
     WHERE name IN $names
       AND deleted_at != NONE
     ORDER BY priority ASC`,
    { names },
  );
  const softPreferred = soft.find((row) => row?.id && !isLegacyId(row.id));
  if (softPreferred?.id) {
    await queryRows(
      db,
      `UPDATE $id SET station = $station, deleted_at = NONE, shows_all = false`,
      { id: asRecord(softPreferred.id), station },
    );
    console.log(
      `[asi-sync] Revived kitchen ${recordIdString(softPreferred.id)} as station=${station}`,
    );
    return softPreferred;
  }

  return null;
}

/** Always hard-delete auto-created kitchen:station_* (never keep them). */
async function purgeLegacyStationKitchens(db) {
  const legacyIds = ['kitchen:station_cuisine', 'kitchen:station_bar'];
  let n = 0;
  for (const id of legacyIds) {
    const rows = await queryRows(db, `SELECT id FROM $id`, { id: asRecord(id) });
    if (!rows[0]?.id) continue;
    await queryRows(db, `DELETE $id`, { id: asRecord(id) });
    n += 1;
  }
  return n;
}

/**
 * Merge ASI dishes into existing kitchen stations (station tag or CUISINE/BAR name).
 * Never auto-creates Cuisine/Bar boards — use Manage → Stations.
 */
async function assignKitchenItems(db, cuisineIds, barIds) {
  // Kill fork leftovers first so they cannot win name matching.
  const legacyRemoved = await purgeLegacyStationKitchens(db);

  const asiRows = await queryRows(
    db,
    `SELECT id FROM menu_item
     WHERE source = 'asi' AND (deleted_at = NONE OR deleted_at = NULL)`,
  );
  const asiSet = new Set(asiRows.map((r) => recordIdString(r.id)));

  async function mergeStation(station, asiDishIds) {
    const kitchen = await resolveKitchenForStation(db, station);
    if (!kitchen?.id) {
      return false;
    }
    const kitchenId = recordIdString(kitchen.id);
    if (kitchenId.includes('station_cuisine') || kitchenId.includes('station_bar')) {
      return false;
    }
    const existing = Array.isArray(kitchen.items) ? kitchen.items : [];
    const kept = existing.map(recordIdString).filter((id) => id && !asiSet.has(id));
    const merged = [...new Set([...kept, ...asiDishIds])].map(asRecord);
    await queryRows(
      db,
      `UPDATE $id SET items = $items, station = $station, deleted_at = NONE, shows_all = false`,
      {
        id: asRecord(kitchenId),
        items: merged,
        station,
      },
    );
    return true;
  }

  const cuisineOk = await mergeStation('cuisine', cuisineIds);
  const barOk = await mergeStation('bar', barIds);
  // Purge again in case anything raced
  const legacyRemoved2 = await purgeLegacyStationKitchens(db);

  if (!cuisineOk && cuisineIds.length > 0) {
    console.warn(
      '[asi-sync] No Cuisine/Kitchen station found; skipped cuisine dish assignment (create one in Manage → Stations).',
    );
  }
  if (!barOk && barIds.length > 0) {
    console.warn(
      '[asi-sync] No Bar station found; skipped bar dish assignment (create one in Manage → Stations).',
    );
  }
  const removed = legacyRemoved + legacyRemoved2;
  if (removed > 0) {
    console.log(`[asi-sync] Purged ${removed} duplicate kitchen:station_* board(s).`);
  }
}

/**
 * POSR Menu UI only shows dishes linked through an active selected menu.
 * Keep a dedicated ASI menu whose items[] = all live ASI dishes, and register it
 * in setting key=menus so the POS cache picks it up.
 */
async function ensureAsiMenu(db, dishEntries) {
  const existing = await queryRows(db, `SELECT id, items FROM ${ASI_MENU_ID}`);
  if (!existing[0]?.id) {
    await queryRows(
      db,
      `CREATE ${ASI_MENU_ID} SET
        name = $name,
        active = true,
        items = [],
        deleted_at = NONE`,
      { name: ASI_MENU_NAME },
    );
  } else {
    await queryRows(
      db,
      `UPDATE ${ASI_MENU_ID} SET name = $name, active = true, deleted_at = NONE`,
      { name: ASI_MENU_NAME },
    );
  }

  // Drop previous ASI menu_menu_item rows owned by this menu
  const prev = await queryRows(db, `SELECT items FROM ${ASI_MENU_ID}`);
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
    const taxMode = entry?.taxInclusive ? 'inclusive' : 'exclusive';
    const created = await queryRows(
      db,
      `CREATE menu_menu_item SET
        menu_item = $dish,
        active = true,
        tax_mode = $taxMode,
        taxes = $taxList,
        tax = $primaryTax`,
      {
        dish: asRecord(dishId),
        taxMode,
        taxList: taxIds.map(asRecord),
        primaryTax: taxIds[0] ? asRecord(taxIds[0]) : null,
      },
    );
    if (created[0]?.id) {
      itemRefs.push(asRecord(created[0].id));
    }
  }

  await queryRows(db, `UPDATE ${ASI_MENU_ID} SET items = $items`, { items: itemRefs });

  // POS tablet = ASI catalog only (not Delivery / demo menus → no "Starter", etc.)
  const settings = await queryRows(
    db,
    `SELECT id, values FROM setting WHERE key = 'menus' AND is_global = true LIMIT 1`,
  );
  const asiRef = asRecord(ASI_MENU_ID);
  if (settings[0]?.id) {
    await queryRows(db, `UPDATE $id SET values = [$menu]`, {
      id: asRecord(settings[0].id),
      menu: asiRef,
    });
  } else {
    await queryRows(
      db,
      `CREATE setting SET key = 'menus', is_global = true, values = [$menu]`,
      { menu: asiRef },
    );
  }

  return itemRefs.length;
}

async function upsertCatalog(db, { groups, activeItems }) {
  /** @type {Map<number, string>} */
  const groupIdToCategory = new Map();
  /** @type {string[]} */
  const categoryIds = [];
  let categoryCount = 0;

  let prio = 10;
  for (const g of groups) {
    if (g.isDeleted) continue;
    const catId = await upsertCategory(db, g, prio);
    groupIdToCategory.set(g.asiGroupId, catId);
    categoryIds.push(catId);
    categoryCount += 1;
    prio += 10;
  }

  const cuisineIds = [];
  const barIds = [];
  const allDishIds = [];
  /** @type {{ id: string, taxIds: string[], taxInclusive: boolean }[]} */
  const dishEntries = [];
  let itemCount = 0;

  const rateToTaxId = await ensureAsiTaxes(db, activeItems);

  for (const item of activeItems) {
    let catId = groupIdToCategory.get(item.asiGroupId);
    if (!catId) {
      catId = await upsertCategory(
        db,
        {
          asiGroupId: item.asiGroupId || 0,
          alias: item.groupAlias,
          name: item.groupName || 'ASI',
          isActive: true,
          isDeleted: false,
        },
        9990,
      );
      groupIdToCategory.set(item.asiGroupId, catId);
      categoryIds.push(catId);
    }

    const dishId = await upsertDish(db, item, catId);
    allDishIds.push(dishId);
    const taxIds = (item.taxes || [])
      .map((t) => rateToTaxId.get(Number(t.rate)))
      .filter(Boolean);
    dishEntries.push({
      id: dishId,
      taxIds: [...new Set(taxIds)],
      taxInclusive: !!item.taxInclusive,
    });
    itemCount += 1;
    if (item.station === 'bar') barIds.push(dishId);
    else cuisineIds.push(dishId);
  }

  const deactivated = await softDeleteMissingAsiDishes(
    db,
    activeItems.map((i) => i.asiItemId),
  );
  const categoriesDeduped = await dedupeAsiCategories(db, categoryIds);

  await assignKitchenItems(db, cuisineIds, barIds);
  const menuItems = await ensureAsiMenu(db, dishEntries);
  await reviveAsiRecords(db, allDishIds, categoryIds);
  const legacyDupes = await softDeleteLegacyAsiPluDupes(db);

  return {
    categories: categoryCount,
    items: itemCount,
    cuisine: cuisineIds.length,
    bar: barIds.length,
    deactivated,
    categoriesDeduped,
    menuItems,
    legacyDupes,
    taxes: rateToTaxId.size,
  };
}

module.exports = {
  upsertCatalog,
  ASI_MENU_ID,
};
