'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { formatBillLineage, mapOrderToTemp } = require('./order-mapping');

test('no lineage prints nothing', () => {
  assert.equal(formatBillLineage(null), '');
  assert.equal(formatBillLineage({}), '');
});

test('a split order names its part and the original order', () => {
  assert.equal(formatBillLineage({ splitFrom: '#088', splitPart: '1/2' }), 'Split 1/2 of #088');
  assert.equal(formatBillLineage({ splitFrom: '#088' }), 'Split from #088');
});

test('a merged order names the orders it gathers', () => {
  assert.equal(formatBillLineage({ mergedFrom: '#081 · #082' }), 'Merged from #081 · #082');
});

test('translated labels fill their placeholders', () => {
  const labels = { splitPartOf: 'Division {part} de {numbers}' };
  assert.equal(formatBillLineage({ splitFrom: '#088', splitPart: '1/2' }, labels), 'Division 1/2 de #088');
});

test('the bill carries the lineage the app sent', () => {
  const bill = mapOrderToTemp({ invoice_number: 89, split: 1, items: [], lineage: { splitFrom: '#088', splitPart: '1/2' } }, {});
  assert.deepEqual(bill.lineage, { splitFrom: '#088', splitPart: '1/2' });
});
