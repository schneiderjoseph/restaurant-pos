'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getOrderDueAt } = require('./order-mapping');

const opts = {
  timezone: 'America/Port-au-Prince',
  locale: 'fr-FR',
  now: new Date('2026-10-03T18:00:00Z'), // 14:00 local
};

test('no due time prints nothing', () => {
  assert.equal(getOrderDueAt({}, opts), '');
  assert.equal(getOrderDueAt({ due_at: null }, opts), '');
  assert.equal(getOrderDueAt(null, opts), '');
});

test('an unreadable due time prints nothing', () => {
  assert.equal(getOrderDueAt({ due_at: 'not a date' }, opts), '');
});

test('a time today prints the time alone, in the print timezone', () => {
  assert.equal(getOrderDueAt({ due_at: '2026-10-03T23:30:00Z' }, opts), '19:30');
});

test('a time on another day prints the day too', () => {
  assert.equal(getOrderDueAt({ due_at: '2026-10-04T12:00:00Z' }, opts), '04/10 08:00');
});

test('the day is compared in the print timezone, not in UTC', () => {
  // 03 Oct 22:00 local is already 04 Oct in UTC.
  assert.equal(getOrderDueAt({ due_at: '2026-10-04T02:00:00Z' }, opts), '22:00');
});
