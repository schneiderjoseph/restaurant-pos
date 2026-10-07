'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getOrderItemModifierLines } = require('./order-mapping');

const pick = (name, nested) => ({ dish: { name }, selectedGroups: nested });

test('one of each side prints one line each', () => {
  const lines = getOrderItemModifierLines({
    item: { name: 'Grilled chicken' },
    modifiers: [{ selectedModifiers: [pick('Fries'), pick('Rice')] }],
  });
  assert.deepEqual(lines, [{ depth: 0, name: 'Fries' }, { depth: 0, name: 'Rice' }]);
});

test('the same side picked twice in a group prints as a count, not once', () => {
  const lines = getOrderItemModifierLines({
    item: { name: 'Grilled chicken' },
    modifiers: [{ selectedModifiers: [pick('Fries'), pick('Rice'), pick('Fries')] }],
  });
  assert.deepEqual(lines, [{ depth: 0, name: '2x Fries' }, { depth: 0, name: 'Rice' }]);
});

test('the same choice repeated across groups still prints once', () => {
  const lines = getOrderItemModifierLines({
    item: { name: 'Burger' },
    modifiers: [
      { selectedModifiers: [pick('Cheese')] },
      { selectedModifiers: [pick('Cheese')] },
    ],
  });
  assert.deepEqual(lines, [{ depth: 0, name: 'Cheese' }]);
});
