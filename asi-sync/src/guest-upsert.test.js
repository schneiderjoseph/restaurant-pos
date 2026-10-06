'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { carriedPreferences, toIsoDay, upsertGuests } = require('./guest-upsert');

test('toIsoDay keeps the day ASI shows (mssql reads datetimes as UTC)', () => {
  assert.strictEqual(toIsoDay(new Date('2026-10-05T00:00:00.000Z')), '2026-10-05');
  assert.strictEqual(toIsoDay('2026-10-05T23:30:00.000Z'), '2026-10-05');
  assert.strictEqual(toIsoDay(null), null);
  assert.strictEqual(toIsoDay('not a date'), null);
});

test('upsertGuests writes the planned departure day on the stay', async () => {
  const writes = [];
  const db = {
    query: async (sql, params) => {
      writes.push({ sql, params });
      return [[]];
    },
  };
  await upsertGuests(db, [
    {
      checkInId: 7,
      guestId: 3,
      folioNo: 'F7',
      unitId: 21,
      name: 'Marie Pierre',
      room: '21',
      phone: null,
      email: null,
      guestCode: 'FD-7',
      dateOut: new Date('2026-10-05T00:00:00.000Z'),
    },
  ]);
  const create = writes.find((w) => /CREATE \$id/.test(w.sql));
  assert.ok(create, 'creates the stay');
  assert.match(create.sql, /asi_date_out = \$asi_date_out/);
  assert.strictEqual(create.params.asi_date_out, '2026-10-05');
});

test('carriedPreferences takes the latest value of each field from the previous stays', () => {
  const carried = carriedPreferences([
    { notes: '', allergies: [], vip: false, seating_pref: 'Terrasse' },
    { notes: 'Aime le griot', allergies: ['Arachides'], vip: true, dietary: ['halal'] },
    { notes: 'old note', allergies: ['Gluten'] },
  ]);
  assert.deepStrictEqual(carried, {
    notes: 'Aime le griot',
    allergies: ['Arachides'],
    dietary: ['halal'],
    seating_pref: 'Terrasse',
    vip: true,
  });
  assert.deepStrictEqual(carriedPreferences([]), {});
});

test('a new stay is created with the preferences of the previous stay', async () => {
  const writes = [];
  const db = {
    query: async (sql, params) => {
      writes.push({ sql, params });
      if (/WHERE asi_guest_id = \$gid/.test(sql)) {
        return [[{ notes: 'VIP du resort', allergies: ['Crustacés'] }]];
      }
      return [[]];
    },
  };
  await upsertGuests(db, [
    { checkInId: 8, guestId: 3, folioNo: 'F8', unitId: 21, name: 'Marie Pierre', room: '21', guestCode: 'FD-8' },
  ]);
  const create = writes.find((w) => /CREATE \$id/.test(w.sql));
  assert.match(create.sql, /notes = \$carried\.notes/);
  assert.match(create.sql, /allergies = \$carried\.allergies/);
  assert.doesNotMatch(create.sql, /dietary/);
  assert.deepStrictEqual(create.params.carried, { notes: 'VIP du resort', allergies: ['Crustacés'] });
});
