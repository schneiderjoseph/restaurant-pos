'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mapOrderToTemp } = require('./order-mapping');

const prestige = (quantity) => ({ item: { name: 'Prestige' }, price: 430, quantity, modifiers: [] });

test('the same beer added in three rounds prints as one bill line', () => {
  const bill = mapOrderToTemp({
    invoice_number: 32,
    items: [
      prestige(2),
      { item: { name: 'Poulet à la diable' }, price: 2000, quantity: 1, modifiers: [] },
      prestige(2),
      prestige(1),
    ],
  });
  const names = bill.items.map((line) => [line.name, line.qty, line.total]);
  assert.deepEqual(names, [
    ['Prestige', 5, 2150],
    ['Poulet à la diable', 1, 2000],
  ]);
});

test('lines with a different note or price stay apart', () => {
  const bill = mapOrderToTemp({
    invoice_number: 1,
    items: [prestige(1), { ...prestige(1), comments: 'bien froide' }, { ...prestige(1), price: 400 }],
  });
  assert.equal(bill.items.length, 3);
});
