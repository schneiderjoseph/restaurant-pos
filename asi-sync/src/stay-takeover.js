'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');

const MONEY_EPS = 0.009;

/** Same rules as src/lib/room-key.ts: digits collapse leading zeros, text is lower-cased. */
function normalizeRoomKey(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  if (/^\d+$/.test(trimmed)) return String(Number(trimmed));
  return trimmed.toLowerCase();
}

/** Every room token on customer.room ("12" or "12, 14"). */
function splitGuestRooms(room) {
  return String(room ?? '')
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Room key -> every key naming the same physical room (floor_table number <-> ASI alias). */
function roomAliasMap(tables) {
  const map = new Map();
  for (const table of tables) {
    const keys = [normalizeRoomKey(table.number), normalizeRoomKey(table.asi_alias)].filter(Boolean);
    for (const key of keys) {
      const set = map.get(key) ?? new Set([key]);
      for (const other of keys) set.add(other);
      map.set(key, set);
    }
  }
  return map;
}

function sameRoomKeys(aliases, room) {
  const key = normalizeRoomKey(room);
  if (!key) return [];
  return [...(aliases.get(key) ?? new Set([key]))];
}

/** Same tags as checkOutStay in src/lib/stay.service.ts. */
function stayTags(tags, inHouse) {
  const list = Array.isArray(tags) ? tags.map(String) : [];
  const without = list.filter((t) => t !== 'in-house' && t !== 'checked-out');
  if (!without.includes('manual-stay')) without.push('manual-stay');
  without.push(inHouse ? 'in-house' : 'checked-out');
  return without;
}

function appendNote(existing, addition) {
  const prev = String(existing ?? '').trim();
  if (!prev) return addition;
  if (prev.includes(addition)) return prev;
  return `${prev}\n${addition}`;
}

/**
 * Pairs each open manual stay with the ASI guest now holding its room (another person).
 * Pure: exported for tests.
 */
function findTakenOverStays({ asiGuests, stays, tables }) {
  const aliases = roomAliasMap(tables);
  const holderByKey = new Map();
  for (const guest of asiGuests) {
    for (const room of splitGuestRooms(guest.room)) {
      for (const key of sameRoomKeys(aliases, room)) {
        if (!holderByKey.has(key)) holderByKey.set(key, guest);
      }
    }
  }
  const out = [];
  for (const stay of stays) {
    const customerId = recordIdString(stay.customer);
    const holder = sameRoomKeys(aliases, stay.room_key || stay.room)
      .map((key) => holderByKey.get(key))
      .find((guest) => guest && recordIdString(guest.id) !== customerId);
    if (holder) out.push({ stay, holder });
  }
  return out;
}

/** Room charges still owed on the stay (Room lines minus cash/card collected). */
async function stayOutstanding(db, stayId) {
  // Room lines sitting only on cancelled / refunded orders do not count (as in loadStayRoomTotal).
  const [row] = await queryRows(
    db,
    `RETURN {
       total: math::sum(SELECT VALUE amount FROM order_payment
         WHERE stay = $stay AND payment_type.type = 'Room'
           AND id NOTINSIDE array::flatten(SELECT VALUE payments FROM order
             WHERE deleted_at = NONE AND status IN ['Cancelled', 'Refunded'] AND payments != NONE)),
       settled: math::sum(SELECT VALUE amount FROM stay_settlement WHERE stay = $stay)
     }`,
    { stay: asRecord(stayId) },
  );
  const total = Number(row?.total) || 0;
  const settled = Number(row?.settled) || 0;
  return { total, outstanding: Math.round((total - settled) * 100) / 100 };
}

/**
 * ASI put someone else in a room that still has an open manual stay: the manual guest has
 * left. A settled stay is checked out here (same writes as the Front Desk check-out, with
 * no user); a stay that still owes Room charges stays open in Front Desk > Conflicts, where
 * the cashier collects and checks out by hand.
 */
async function closeAsiTakenOverStays(db, { now = new Date() } = {}) {
  const [asiGuests, stays, tables] = await Promise.all([
    queryRows(
      db,
      `SELECT id, name, room FROM customer
       WHERE deleted_at = NONE AND source = 'asi-fd'
         AND (in_house = true OR tags CONTAINS 'in-house')
         AND room != NONE AND room != NULL`,
    ),
    queryRows(db, `SELECT id, customer, room, room_key FROM stay WHERE status = 'open'`),
    queryRows(
      db,
      `SELECT number, asi_alias FROM floor_table WHERE deleted_at = NONE AND source = 'asi-room'`,
    ),
  ]);

  let closed = 0;
  const unsettled = [];
  for (const { stay, holder } of findTakenOverStays({ asiGuests, stays, tables })) {
    const { total, outstanding } = await stayOutstanding(db, stay.id);
    if (outstanding > MONEY_EPS) {
      unsettled.push({ room: stay.room, outstanding });
      continue;
    }
    const [customer] = await queryRows(db, `SELECT id, tags, notes FROM ONLY $id`, {
      id: asRecord(stay.customer),
    });
    if (!customer) continue;
    const day = now.toISOString().slice(0, 10);
    const note = `Check-out auto ${day} : chambre ${stay.room} reprise dans ASI par ${holder.name || 'un client ASI'}.`;
    await queryRows(
      db,
      `BEGIN TRANSACTION;
       LET $stay = (SELECT * FROM ONLY $id);
       IF $stay = NONE OR $stay.status != 'open' { THROW 'stay_not_open' };
       UPDATE $id SET
         status = 'closed',
         checked_out_by = NONE,
         checked_out_at = time::now(),
         room_total_at_checkout = $total;
       LET $remaining = (SELECT id, room, checked_in_at FROM stay
         WHERE status = 'open' AND customer = $customer
         ORDER BY checked_in_at DESC);
       IF array::len($remaining) = 0 {
         UPDATE $customer SET
           current_stay = NONE,
           in_house = false,
           room = NONE,
           tags = $tags_out,
           notes = $notes,
           updated_at = time::now();
       } ELSE {
         UPDATE $customer SET
           current_stay = $remaining[0].id,
           in_house = true,
           room = array::join((SELECT VALUE room FROM $remaining), ', '),
           tags = $tags_still,
           notes = $notes,
           updated_at = time::now();
       };
       COMMIT TRANSACTION;`,
      {
        id: asRecord(stay.id),
        customer: asRecord(stay.customer),
        total,
        tags_out: stayTags(customer.tags, false),
        tags_still: stayTags(customer.tags, true),
        notes: appendNote(customer.notes, note),
      },
    );
    closed += 1;
  }
  return { closed, unsettled };
}

module.exports = {
  closeAsiTakenOverStays,
  findTakenOverStays,
  normalizeRoomKey,
  roomAliasMap,
  stayTags,
};
