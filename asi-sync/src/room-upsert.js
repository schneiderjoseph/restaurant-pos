'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');

const ASI_ROOMS_FLOOR_ID = 'floor:resort_chambres';
const ASI_ROOMS_FLOOR_NAME = 'Chambres';

/** Compact grid (same density as dining Salle). */
const LAYOUT = {
  cols: 7,
  size: 96,
  gap: 20,
  paddingX: 24,
  paddingY: 24,
};

function roomRecordId(asiUnitId) {
  return `floor_table:asi_r_${asiUnitId}`;
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

async function ensureRoomsFloor(db) {
  const existing = await queryRows(
    db,
    `SELECT * FROM floor
     WHERE id = $id OR (name = $name AND deleted_at = NONE)
     LIMIT 1`,
    { id: asRecord(ASI_ROOMS_FLOOR_ID), name: ASI_ROOMS_FLOOR_NAME },
  );
  if (existing[0]?.id) {
    return recordIdString(existing[0].id);
  }

  await queryRows(
    db,
    `CREATE $id SET
      name = $name,
      priority = 2,
      background = '#ecfdf5',
      color = '#064e3b',
      deleted_at = NONE`,
    { id: asRecord(ASI_ROOMS_FLOOR_ID), name: ASI_ROOMS_FLOOR_NAME },
  );
  return ASI_ROOMS_FLOOR_ID;
}

async function upsertOneRoom(db, floorId, room, priority) {
  const id = roomRecordId(room.asiUnitId);
  const pos = gridPosition(priority - 1);
  const size = pos.size;
  const background = '#86efac';
  const color = '#14532d';

  const existing = await queryRows(db, `SELECT id FROM $id`, {
    id: asRecord(id),
  });

  const vars = {
    id: asRecord(id),
    name: room.name,
    number: room.number,
    priority,
    floor: asRecord(floorId),
    background,
    color,
    height: size,
    width: size,
    x: pos.x,
    y: pos.y,
    capacity: room.capacity,
    asi_unit_id: room.asiUnitId,
    asi_alias: room.alias || null,
  };

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
        source = 'asi-room',
        asi_unit_id = $asi_unit_id,
        asi_alias = $asi_alias,
        asi_synced_at = time::now(),
        deleted_at = NONE`,
      vars,
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
      source = 'asi-room',
      asi_unit_id = $asi_unit_id,
      asi_alias = $asi_alias,
      asi_synced_at = time::now(),
      deleted_at = NONE`,
    vars,
  );
  return { id, created: true };
}

async function softDeleteMissingRooms(db, activeIds) {
  const rows = await queryRows(
    db,
    `SELECT id, asi_unit_id FROM floor_table
     WHERE source = 'asi-room'
       AND deleted_at = NONE`,
  );
  const keep = new Set(activeIds.map(Number));
  let deactivated = 0;
  for (const row of rows) {
    const aid = Number(row.asi_unit_id);
    if (Number.isFinite(aid) && keep.has(aid)) continue;
    await queryRows(db, `UPDATE $id SET deleted_at = time::now()`, {
      id: asRecord(row.id),
    });
    deactivated += 1;
  }
  return deactivated;
}

/**
 * Upsert ASI hotel rooms onto the Chambres floor (grid layout).
 */
async function upsertRooms(db, { rooms }) {
  const floorId = await ensureRoomsFloor(db);
  const sorted = [...rooms].sort(
    (a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.number).localeCompare(String(b.number)),
  );

  let created = 0;
  let updated = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    const result = await upsertOneRoom(db, floorId, sorted[i], i + 1);
    if (result.created) created += 1;
    else updated += 1;
  }

  const deactivated = await softDeleteMissingRooms(
    db,
    sorted.map((r) => r.asiUnitId),
  );

  return {
    floor: floorId,
    rooms: sorted.length,
    created,
    updated,
    deactivated,
    layout: 'grid',
  };
}

module.exports = {
  upsertRooms,
  roomRecordId,
  ASI_ROOMS_FLOOR_ID,
  ASI_ROOMS_FLOOR_NAME,
};
