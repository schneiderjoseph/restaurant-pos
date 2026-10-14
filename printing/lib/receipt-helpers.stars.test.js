'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toPrinterText, buildItemRowString, formatItemLine } = require('./receipt-helpers');

test('toPrinterText maps Unicode stars to ASCII asterisks', () => {
  assert.equal(toPrinterText('Rhum 5 ★★★★★'), 'Rhum 5 *****');
  assert.equal(toPrinterText('Cuba Libre 3 ★★★ Simple'), 'Cuba Libre 3 *** Simple');
  assert.equal(toPrinterText('Rhum 3***'), 'Rhum 3***');
});

test('item lines print asterisks instead of Unicode stars', () => {
  const config = {
    showItemName: true,
    showItemQuantity: true,
    showItemPrice: false,
    showItemTotal: true,
    decimal_place: 0,
  };
  const row = buildItemRowString({ name: 'Rhum 5 ★★★★★', qty: 1, price: 700, total: 700 }, config);
  assert.match(row, /Rhum 5 \*\*\*\*\*/);
  assert.equal(row.includes('★'), false);
  const line = formatItemLine({ name: 'Rhum Punch 3 ★★★', qty: 2 }, config);
  assert.match(line, /\*\*\*/);
  assert.equal(line.includes('★'), false);
});
