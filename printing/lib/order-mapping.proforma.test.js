'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { mapOrderToTemp } = require('./order-mapping');

const sampleOrder = {
  invoice_number: 12,
  created_at: '2026-10-10T12:00:00.000Z',
  items: [],
  tax_amount: 0,
  discount_amount: 0,
  service_charge_amount: 0,
  tip_amount: 0,
  payments: [],
};

describe('mapOrderToTemp proforma', () => {
  it('defaults to Pre-Sale Bill without a documentKind', () => {
    const bill = mapOrderToTemp(sampleOrder, {
      labels: { preSaleBill: 'Addition provisoire' },
    });
    assert.equal(bill.title, 'Addition provisoire');
    assert.equal(bill.note, '');
    assert.equal(bill.documentKind, 'temp');
  });

  it('uses Proforma title and price disclaimer when documentKind is proforma', () => {
    const bill = mapOrderToTemp(sampleOrder, {
      documentKind: 'proforma',
      labels: {
        proformaBill: 'Proforma',
        proformaNote: 'Prices may vary. This is not a final invoice.',
      },
    });
    assert.equal(bill.title, 'Proforma');
    assert.match(bill.note, /Prices may vary/i);
    assert.equal(bill.documentKind, 'proforma');
  });
});
