'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { findTakenOverStays, normalizeRoomKey, stayTags } = require('./stay-takeover');

const asi = (id, room, name = 'ASI guest') => ({ id: `customer:${id}`, room, name });
const stay = (id, customer, room) => ({ id: `stay:${id}`, customer: `customer:${customer}`, room, room_key: normalizeRoomKey(room) });

test('a manual stay whose room ASI gave to someone else is taken over', () => {
  const out = findTakenOverStays({
    asiGuests: [asi('asi_fd_1', '15', 'Gaetan')],
    stays: [stay('a', 'eve', '15'), stay('b', 'marc', '23')],
    tables: [],
  });
  assert.deepStrictEqual(out.map((row) => [row.stay.id, row.holder.name]), [['stay:a', 'Gaetan']]);
});

test('room numbers match with leading zeros and through the ASI alias', () => {
  const out = findTakenOverStays({
    asiGuests: [asi('asi_fd_1', '015'), asi('asi_fd_2', 'PH1')],
    stays: [stay('a', 'eve', '15'), stay('b', 'marc', '40')],
    tables: [{ number: '40', asi_alias: 'PH1' }],
  });
  assert.deepStrictEqual(out.map((row) => row.stay.id), ['stay:a', 'stay:b']);
});

test('an ASI guest holding several rooms takes over each of them', () => {
  const out = findTakenOverStays({
    asiGuests: [asi('asi_fd_1', '12, 14')],
    stays: [stay('a', 'eve', '14')],
    tables: [],
  });
  assert.strictEqual(out.length, 1);
});

test('the same customer on both sides is not a takeover', () => {
  const out = findTakenOverStays({
    asiGuests: [asi('eve', '15')],
    stays: [stay('a', 'eve', '15')],
    tables: [],
  });
  assert.strictEqual(out.length, 0);
});

test('stayTags matches the Front Desk check-out tags', () => {
  assert.deepStrictEqual(stayTags(['vip', 'in-house', 'manual-stay'], false), ['vip', 'manual-stay', 'checked-out']);
  assert.deepStrictEqual(stayTags(['vip', 'checked-out'], true), ['vip', 'manual-stay', 'in-house']);
});
