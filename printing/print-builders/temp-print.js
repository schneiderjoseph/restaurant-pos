'use strict';

const { normalizeConfig, printReceiptHeader } = require('../lib/receipt-helpers');
const { printBillLayout } = require('../lib/bill-layout');
const { mapOrderToTemp, scaleBillAmounts } = require('../lib/order-mapping');

/**
 * Temp print – Pre-Sale Bill (no payments/change).
 * Expects data: { order: Order, qrcodes?, qrcode? }. Order from src/api/model/order.ts.
 * Optional config.currencyScale + config.currencyCode convert amounts (e.g. HTG ↔ USD).
 */
function build(printer, data = {}, config = {}) {
  const order = data && data.order;
  if (!order) {
    return Promise.reject(new Error('data.order is required for temp print'));
  }

  const cfg = normalizeConfig(config);
  let bill = mapOrderToTemp(order, {
    showInclusivePrices: !!cfg.showInclusivePrices,
    labels: cfg.labels,
    timezone: cfg.timezone,
    locale: cfg.locale,
  });
  bill = scaleBillAmounts(bill, cfg.currencyScale, cfg.currencyCode);

  return printReceiptHeader(printer, cfg).then(() => {
    return printBillLayout(printer, bill, cfg, {
      title: bill.title,
      qrcode: data.qrcode,
      qrcodes: data.qrcodes,
      notes: bill.note || undefined,
      customerName: order.customer?.name || undefined,
      phone: order.customer?.phone || undefined,
      showPayments: false,
      showChange: false,
      showDeliveryLine: false,
    }).then(() => printer);
  });
}

module.exports = { build };
