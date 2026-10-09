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

const sidePick = (name, price = 0) => ({
  dish: { name },
  price,
  quantity: 1,
  selectedGroups: [],
});

test('same fish oz with different free sides prints as one line listing every side', () => {
  const fish = (side) => ({
    item: { name: 'Poisson grillé' },
    price: 3860,
    quantity: 1,
    variant: '12 oz',
    modifiers: [{ selectedModifiers: [sidePick(side, 0)] }],
  });
  const bill = mapOrderToTemp({
    invoice_number: 59,
    items: [fish('Riz'), fish('Frites'), fish('Purée')],
  });
  assert.equal(bill.items.length, 1);
  assert.equal(bill.items[0].qty, 3);
  assert.equal(bill.items[0].name, 'Poisson grillé');
  assert.deepEqual(
    bill.items[0].modifierLines.map((line) => [line.variant || false, line.name]),
    [
      [true, '12 oz'],
      [false, 'Riz'],
      [false, 'Frites'],
      [false, 'Purée'],
    ],
  );
});

test('different oz stay on separate bill lines', () => {
  const bill = mapOrderToTemp({
    invoice_number: 1,
    items: [
      {
        item: { name: 'Poisson grillé' },
        price: 3860,
        quantity: 1,
        variant: '12 oz',
        modifiers: [],
      },
      {
        item: { name: 'Poisson grillé' },
        price: 5146,
        quantity: 1,
        variant: '16 oz',
        modifiers: [],
      },
    ],
  });
  assert.equal(bill.items.length, 2);
});

test('paid side vs free side keeps lines apart (unit price differs)', () => {
  const bill = mapOrderToTemp({
    invoice_number: 1,
    items: [
      {
        item: { name: 'Poisson grillé' },
        price: 3860,
        quantity: 1,
        variant: '12 oz',
        modifiers: [{ selectedModifiers: [sidePick('Riz', 0)] }],
      },
      {
        item: { name: 'Poisson grillé' },
        price: 3860,
        quantity: 1,
        variant: '12 oz',
        modifiers: [{ selectedModifiers: [sidePick('Frites', 150)] }],
      },
    ],
  });
  assert.equal(bill.items.length, 2);
});

const { scaleBillAmounts } = require('./order-mapping');

test('scaleBillAmounts converts HTG totals into USD for a prebill', () => {
  const bill = mapOrderToTemp({
    invoice_number: 1,
    items: [prestige(2)],
    tax_amount: 0,
  });
  const usd = scaleBillAmounts(bill, 1 / 132, 'USD');
  assert.equal(usd.itemsTotal, 6.52);
  assert.equal(usd.total, 6.52);
  assert.equal(usd.items[0].total, 6.52);
});

test('scaleBillAmounts rounds HTG to whole gourdes', () => {
  const bill = { itemsTotal: 10, total: 10, items: [{ price: 10, total: 10 }], taxLines: [], discountLines: [], extras: [], payments: [] };
  const htg = scaleBillAmounts(bill, 132, 'HTG');
  assert.equal(htg.total, 1320);
});
