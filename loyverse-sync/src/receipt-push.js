'use strict';

/**
 * Phase 2/3: push a closed POSR order as a Loyverse receipt (RECEIPTS_WRITE).
 * Not wired into the UI yet — call from a future payment-close hook.
 *
 * Mapping notes (document in LOYVERSE.md):
 * - line_items[].variant_id ← menu_item.loyverse_variant_id
 * - payments[].payment_type_id ← payment_type.loyverse_id
 * - store_id ← LOYVERSE_STORE_ID
 */

class LoyverseReceiptClient {
  /**
   * @param {{ token: string, baseUrl: string }} opts
   */
  constructor(opts) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  /**
   * @param {object} receiptBody Loyverse Receipt create payload
   */
  async createReceipt(receiptBody) {
    const res = await fetch(`${this.baseUrl}/receipts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(receiptBody),
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!res.ok) {
      const msg = body?.errors?.[0]?.details || body?.message || text || res.statusText;
      throw new Error(`Loyverse receipt ${res.status}: ${msg}`);
    }
    return body;
  }
}

/**
 * Build a minimal Loyverse receipt from a normalised POSR order snapshot.
 * @param {{
 *   storeId: string,
 *   employeeId?: string|null,
 *   lineItems: Array<{ variantId: string, quantity: number, price: number }>,
 *   payments: Array<{ paymentTypeId: string, moneyAmount: number }>,
 *   note?: string,
 * }} order
 */
function buildReceiptPayload(order) {
  return {
    store_id: order.storeId,
    employee_id: order.employeeId || undefined,
    order: order.note || undefined,
    line_items: order.lineItems.map((li) => ({
      variant_id: li.variantId,
      quantity: li.quantity,
      price: li.price,
    })),
    payments: order.payments.map((p) => ({
      payment_type_id: p.paymentTypeId,
      money_amount: p.moneyAmount,
    })),
  };
}

module.exports = {
  LoyverseReceiptClient,
  buildReceiptPayload,
};
