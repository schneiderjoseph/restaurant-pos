'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');

function customerRecordId(checkInId) {
  return `customer:asi_fd_${checkInId}`;
}

/**
 * FrontDesk dates as a calendar day "YYYY-MM-DD". SQL Server datetimes have no zone and
 * mssql reads them as UTC, so the UTC fields carry the day ASI shows.
 */
function toIsoDay(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** What a guest's new stay takes from the previous ones (staff note and preferences). */
const CARRIED_FIELDS = [
  'notes', 'allergies', 'dietary', 'seating_pref', 'language', 'birthday', 'vip', 'marketing_consent',
];

const hasValue = (value) => {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/**
 * For each carried field, the latest value set on one of the previous stays (newest first).
 * A boolean is carried only when true: false is the default anyway.
 */
function carriedPreferences(previousStays) {
  const carried = {};
  for (const field of CARRIED_FIELDS) {
    const stay = previousStays.find((row) => hasValue(row[field]) && row[field] !== false);
    if (stay) carried[field] = stay[field];
  }
  return carried;
}

/**
 * Upsert in-house FrontDesk guests into POSR customers.
 * Soft-clears room / in-house for previous ASI stays no longer checked in.
 *
 * id: customer:asi_fd_{checkInID}
 * guest_code: FD-{checkInID}
 * tags: asi, asi-fd, in-house (+ folio:…)
 * source: asi-fd
 */
async function upsertGuests(db, guests) {
  const activeCodes = new Set();
  let created = 0;
  let updated = 0;

  for (const g of guests) {
    activeCodes.add(g.guestCode);
    const id = customerRecordId(g.checkInId);
    const tags = ['asi', 'asi-fd', 'in-house'];
    if (g.folioNo) tags.push(`folio:${g.folioNo}`);

    const payload = {
      name: g.name,
      guest_code: g.guestCode,
      room: g.room,
      phone: g.phone || null,
      email: g.email || null,
      asi_guest_id: g.guestId,
      asi_checkin_id: g.checkInId,
      asi_folio_no: g.folioNo,
      asi_unit_id: g.unitId,
      asi_date_out: toIsoDay(g.dateOut),
      source: 'asi-fd',
      in_house: true,
      tags,
    };

    const existing = await queryRows(db, `SELECT id FROM $id`, { id: asRecord(id) });
    // UPDATEs use `$phone ?? phone`: a number staff added in POSR survives polls
    // while FrontDesk has none; FrontDesk wins once it has one.
    if (existing[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          name = $name,
          guest_code = $guest_code,
          room = $room,
          phone = $phone ?? phone,
          email = $email,
          asi_guest_id = $asi_guest_id,
          asi_checkin_id = $asi_checkin_id,
          asi_folio_no = $asi_folio_no,
          asi_unit_id = $asi_unit_id,
          asi_date_out = $asi_date_out,
          source = $source,
          in_house = true,
          asi_synced_at = time::now(),
          tags = $tags`,
        { id: asRecord(id), ...payload },
      );
      updated += 1;
    } else {
      // New stay: carry the staff note and preferences over from this guest's previous
      // stays. Only on CREATE, so what staff edit or clear in POSR survives later polls.
      const carried = g.guestId != null
        ? carriedPreferences(await queryRows(
          db,
          `SELECT ${CARRIED_FIELDS.join(', ')}, asi_synced_at FROM customer
           WHERE asi_guest_id = $gid
           ORDER BY asi_synced_at DESC LIMIT 10`,
          { gid: g.guestId },
        ))
        : {};
      // Only name the fields that have a value: keeps this CREATE valid on a DB without
      // migrations/2026_10_01_customer_notes.surql or 2026_10_06_customer_management.surql.
      const notesSet = Object.keys(carried).map((field) => `${field} = $carried.${field},`).join(' ');
      try {
        await queryRows(
          db,
          `CREATE $id SET
            name = $name,
            guest_code = $guest_code,
            room = $room,
            phone = $phone,
            email = $email,
            asi_guest_id = $asi_guest_id,
            asi_checkin_id = $asi_checkin_id,
            asi_folio_no = $asi_folio_no,
            asi_unit_id = $asi_unit_id,
            asi_date_out = $asi_date_out,
            source = $source,
            in_house = true,
            asi_synced_at = time::now(),
            tags = $tags,
            ${notesSet}
            points = 0`,
          { id: asRecord(id), ...payload, carried },
        );
        created += 1;
      } catch (err) {
        const byCode = await queryRows(
          db,
          `SELECT id FROM customer WHERE guest_code = $code LIMIT 1`,
          { code: g.guestCode },
        );
        if (byCode[0]?.id) {
          await queryRows(
            db,
            `UPDATE $id SET
              name = $name,
              room = $room,
              phone = $phone ?? phone,
              email = $email,
              asi_guest_id = $asi_guest_id,
              asi_checkin_id = $asi_checkin_id,
              asi_folio_no = $asi_folio_no,
              asi_unit_id = $asi_unit_id,
              asi_date_out = $asi_date_out,
              source = $source,
              in_house = true,
              asi_synced_at = time::now(),
              tags = $tags`,
            { id: asRecord(recordIdString(byCode[0].id)), ...payload },
          );
          updated += 1;
        } else {
          throw err;
        }
      }
    }
  }

  const stale = await queryRows(
    db,
    `SELECT id, guest_code, tags FROM customer
     WHERE source = 'asi-fd'
       AND (tags CONTAINS 'in-house' OR in_house = true)`,
  );

  let checkedOut = 0;
  for (const row of stale) {
    const code = row.guest_code;
    if (code && activeCodes.has(code)) continue;
    const tags = Array.isArray(row.tags)
      ? row.tags.filter((t) => t !== 'in-house')
      : [];
    if (!tags.includes('checked-out')) tags.push('checked-out');
    await queryRows(
      db,
      `UPDATE $id SET
        tags = $tags,
        room = NONE,
        in_house = false,
        asi_synced_at = time::now()`,
      { id: asRecord(row.id), tags },
    );
    checkedOut += 1;
  }

  return {
    inHouse: guests.length,
    created,
    updated,
    checkedOut,
  };
}

module.exports = { upsertGuests, customerRecordId, toIsoDay, carriedPreferences };
