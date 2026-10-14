'use strict';

const { normalizeConfig, printReceiptHeader } = require('../lib/receipt-helpers');
const { printBillLayout } = require('../lib/bill-layout');
const { mapOrderToTemp, scaleBillAmounts } = require('../lib/order-mapping');

/**
 * Temp print – Pre-Sale Bill (no payments/change).
 * Expects data: { order: Order, qrcodes?, qrcode?, documentKind?: 'temp'|'proforma' }.
 * Proforma prints "Proforma"/"Quote" with a prices-may-vary disclaimer.
 * Optional config.currencyScale + config.currencyCode convert amounts (e.g. HTG ↔ USD).
 */
function build(printer, data = {}, config = {}) {
  const order = data && data.order;
  if (!order) {
    return Promise.reject(new Error('data.order is required for temp print'));
  }

  const documentKind = data.documentKind === 'proforma' ? 'proforma' : 'temp';
  const cfg = normalizeConfig(config);
  let bill = mapOrderToTemp(order, {
    showInclusivePrices: !!cfg.showInclusivePrices,
    labels: cfg.labels,
    timezone: cfg.timezone,
    locale: cfg.locale,
    documentKind,
  });
  bill = scaleBillAmounts(bill, cfg.currencyScale, cfg.currencyCode);
  const isProforma = bill.documentKind === 'proforma';

  return printReceiptHeader(printer, cfg).then(() => {
    return printBillLayout(printer, bill, cfg, {
      title: bill.title,
      qrcode: data.qrcode,
      qrcodes: data.qrcodes,
      notes: isProforma ? undefined : (bill.note || undefined),
      disclaimer: isProforma ? (bill.note || undefined) : undefined,
      customerName: order.customer?.name || undefined,
      phone: order.customer?.phone || undefined,
      showPayments: false,
      showChange: false,
      showDeliveryLine: false,
    }).then(() => printer);
  });
}

module.exports = { build };
