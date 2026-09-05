'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');

const ASI_FLOOR_ID = 'floor:resort_salle';
const ASI_FLOOR_NAME = 'Salle';

/** Compact grid (matches src/lib/resort-floor-tables RESORT_TABLE_LAYOUT). */
const LAYOUT = {
  cols: 8,
  size: 96,
  gap: 20,
  paddingX: 24,
  paddingY: 24,
};

function tableRecordId(asiTableId) {
  return `floor_table:asi_t_${asiTableId}`;
}

function gridPosition(indexZeroBased) {
  const col = indexZeroBased % LAYOUT.cols;
  const row = Math.floor(indexZeroBased / LAYOUT.cols);
  return {
    x: LAYOUT.paddingX + col * (LAYOUT.size + LAYOUT.gap),
    y: LAYOUT.paddingY + row * (LAYOUT.size + LAYOUT.gap),
    size: LAYOUT.size,
  };
}

/**
 * Use ASI pixel layout only when enough tables have coordinates.
 * Some properties only have layout coords for a handful of tables — fall back to grid.
 */
function shouldUseAsiCoords(tables) {
  const withXy = tables.filter((t) => t.left != null && t.top != null).length;
  return withXy >= Math.max(2, Math.ceil(tables.length * 0.4));
}

function sortKey(t) {
  // Salle (T*) then Bar (B*), numeric within group
  const group = t.name === 'B' ? 1 : 0;
  const n = Number(t.number) || 0;
  return group * 1000 + n;
}

async function ensureAsiFloor(db) {
  const existing = await queryRows(
    db,
    `SELECT * FROM floor
     WHERE id = $id OR (name = $name AND deleted_at = NONE)
     LIMIT 1`,
    { id: asRecord(ASI_FLOOR_ID), name: ASI_FLOOR_NAME },
  );
  if (existing[0]?.id) {
    return recordIdString(existing[0].id);
  }

  await queryRows(
    db,
    `CREATE $id SET
      name = $name,
      priority = 1,
      background = '#f1f5f9',
      color = '#0f172a',
      deleted_at = NONE`,
    { id: asRecord(ASI_FLOOR_ID), name: ASI_FLOOR_NAME },
  );
  return ASI_FLOOR_ID;
}

/**
 * Soft-delete local resort seed tables (floor_table:resort_t_*) so ASI catalog wins.
 */
async function softDeleteLocalResortSeed(db, floorId) {
  const seedIds = Array.from({ length: 40 }, (_, i) =>
    asRecord(`floor_table:resort_t_${i + 1}`),
  );
  const byId = await queryRows(
    db,
    `SELECT id FROM floor_table
     WHERE deleted_at = NONE
       AND floor = $floor
       AND id INSIDE $seedIds`,
    { floor: asRecord(floorId), seedIds },
  );
  // Also clear legacy auto-seeded 1–32 without asi source (random Surreal ids).
  const byNumber = await queryRows(
    db,
    `SELECT id FROM floor_table
     WHERE deleted_at = NONE
       AND floor = $floor
       AND (source = NONE OR source IS NONE OR source = NULL OR source != 'asi')
       AND number IN $numbers`,
    {
      floor: asRecord(floorId),
      numbers: Array.from({ length: 40 }, (_, i) => String(i + 1)),
    },
  );
  const seen = new Set();
  let n = 0;
  for (const row of [...byId, ...byNumber]) {
    const sid = recordIdString(row.id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    await queryRows(
      db,
      `UPDATE $id SET deleted_at = time::now()`,
      { id: asRecord(row.id) },
    );
    n += 1;
  }
  return n;
}

async function upsertOneTable(db, floorId, table, priority, useAsiCoords) {
  const id = tableRecordId(table.asiTableId);
  let x;
  let y;
  let size = LAYOUT.size;
  if (useAsiCoords && table.left != null && table.top != null) {
    // ASI stores small floats; scale into POSR floor pixels.
    x = Math.round(Number(table.left) * 8);
    y = Math.round(Number(table.top) * 8);
    if (table.width && table.height) {
      size = Math.max(
        72,
        Math.round(Math.max(Number(table.width), Number(table.height)) * 10),
      );
    }
  } else {
    const pos = gridPosition(priority - 1);
    x = pos.x;
    y = pos.y;
    size = pos.size;
  }

  const isBar = table.name === 'B';
  const background = isBar ? '#fde68a' : '#bfdbfe';
  const payload = {
    name: table.name,
    number: table.number,
    priority,
    floor: asRecord(floorId),
    ask_for_covers: false,
    allow_multiple_orders: true,
    background,
    color: '#0f172a',
    height: size,
    width: size,
    x,
    y,
    rounded: 'rounded-xl',
    categories: [],
    order_types: [],
    payment_types: [],
    is_locked: false,
    capacity: table.capacity,
    source: 'asi',
    asi_table_id: table.asiTableId,
    asi_alias: table.alias || null,
  };

  const existing = await queryRows(db, `SELECT id FROM $id`, {
    id: asRecord(id),
  });

  if (existing[0]?.id) {
    await queryRows(
      db,
      `UPDATE $id SET
        name = $name,
        number = $number,
        priority = $priority,
        floor = $floor,
        ask_for_covers = false,
        allow_multiple_orders = true,
        background = $background,
        color = $color,
        height = $height,
        width = $width,
        x = $x,
        y = $y,
        rounded = 'rounded-xl',
        capacity = $capacity,
        source = 'asi',
        asi_table_id = $asi_table_id,
        asi_alias = $asi_alias,
        asi_synced_at = time::now(),
        deleted_at = NONE`,
      {
        id: asRecord(id),
        name: payload.name,
        number: payload.number,
        priority: payload.priority,
        floor: payload.floor,
        background: payload.background,
        color: payload.color,
        height: payload.height,
        width: payload.width,
        x: payload.x,
        y: payload.y,
        capacity: payload.capacity,
        asi_table_id: payload.asi_table_id,
        asi_alias: payload.asi_alias,
      },
    );
    return { id, created: false };
  }

  await queryRows(
    db,
    `CREATE $id SET
      name = $name,
      number = $number,
      priority = $priority,
      floor = $floor,
      ask_for_covers = false,
      allow_multiple_orders = true,
      background = $background,
      color = $color,
      height = $height,
      width = $width,
      x = $x,
      y = $y,
      rounded = 'rounded-xl',
      categories = [],
      order_types = [],
      payment_types = [],
      is_locked = false,
      capacity = $capacity,
      source = 'asi',
      asi_table_id = $asi_table_id,
      asi_alias = $asi_alias,
      asi_synced_at = time::now(),
      deleted_at = NONE`,
    {
      id: asRecord(id),
      name: payload.name,
      number: payload.number,
      priority: payload.priority,
      floor: payload.floor,
      background: payload.background,
      color: payload.color,
      height: payload.height,
      width: payload.width,
      x: payload.x,
      y: payload.y,
      capacity: payload.capacity,
      asi_table_id: payload.asi_table_id,
      asi_alias: payload.asi_alias,
    },
  );
  return { id, created: true };
}

async function softDeleteMissingAsiTables(db, activeIds) {
  const rows = await queryRows(
    db,
    `SELECT id, asi_table_id FROM floor_table
     WHERE source = 'asi'
       AND deleted_at = NONE`,
  );
  const keep = new Set(activeIds.map(Number));
  let deactivated = 0;
  for (const row of rows) {
    const aid = Number(row.asi_table_id);
    if (Number.isFinite(aid) && keep.has(aid)) continue;
    await queryRows(
      db,
      `UPDATE $id SET deleted_at = time::now()`,
      { id: asRecord(row.id) },
    );
    deactivated += 1;
  }
  return deactivated;
}

/**
 * Upsert ASI dining tables onto the resort Salle floor.
 */
async function upsertTables(db, { tables }) {
  const floorId = await ensureAsiFloor(db);
  const sorted = [...tables].sort((a, b) => sortKey(a) - sortKey(b));
  const useAsiCoords = shouldUseAsiCoords(sorted);

  let created = 0;
  let updated = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const result = await upsertOneTable(
      db,
      floorId,
      sorted[i],
      i + 1,
      useAsiCoords,
    );
    if (result.created) created += 1;
    else updated += 1;
  }

  const deactivated = await softDeleteMissingAsiTables(
    db,
    sorted.map((t) => t.asiTableId),
  );
  const localSeedRemoved = await softDeleteLocalResortSeed(db, floorId);

  return {
    floor: floorId,
    tables: sorted.length,
    created,
    updated,
    deactivated,
    localSeedRemoved,
    layout: useAsiCoords ? 'asi' : 'grid',
  };
}

module.exports = {
  upsertTables,
  tableRecordId,
  ASI_FLOOR_ID,
};
