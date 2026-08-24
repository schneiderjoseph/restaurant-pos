'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');

function customerRecordId(checkInId) {
  return `customer:asi_fd_${checkInId}`;
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
      source: 'asi-fd',
      in_house: true,
      tags,
    };

    const existing = await queryRows(db, `SELECT id FROM $id`, { id: asRecord(id) });
    if (existing[0]?.id) {
      await queryRows(
        db,
        `UPDATE $id SET
          name = $name,
          guest_code = $guest_code,
          room = $room,
          phone = $phone,
          email = $email,
          asi_guest_id = $asi_guest_id,
          asi_checkin_id = $asi_checkin_id,
          asi_folio_no = $asi_folio_no,
          asi_unit_id = $asi_unit_id,
          source = $source,
          in_house = true,
          asi_synced_at = time::now(),
          tags = $tags`,
        { id: asRecord(id), ...payload },
      );
      updated += 1;
    } else {
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
            source = $source,
            in_house = true,
            asi_synced_at = time::now(),
            tags = $tags,
            points = 0`,
          { id: asRecord(id), ...payload },
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
              phone = $phone,
              email = $email,
              asi_guest_id = $asi_guest_id,
              asi_checkin_id = $asi_checkin_id,
              asi_folio_no = $asi_folio_no,
              asi_unit_id = $asi_unit_id,
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

module.exports = { upsertGuests, customerRecordId };
