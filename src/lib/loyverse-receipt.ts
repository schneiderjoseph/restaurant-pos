/**
 * App-side helper for future payment-close → Loyverse receipt push.
 * Actual HTTP call stays in loyverse-sync (server); this only shapes the payload.
 */
export type LoyverseReceiptLine = {
  variantId: string;
  quantity: number;
  price: number;
};

export type LoyverseReceiptPayment = {
  paymentTypeId: string;
  moneyAmount: number;
};

export type LoyverseReceiptDraft = {
  storeId: string;
  employeeId?: string | null;
  note?: string;
  lineItems: LoyverseReceiptLine[];
  payments: LoyverseReceiptPayment[];
};

export function buildLoyverseReceiptDraft(input: LoyverseReceiptDraft): LoyverseReceiptDraft {
  return {
    storeId: input.storeId,
    employeeId: input.employeeId ?? null,
    note: input.note,
    lineItems: input.lineItems.filter((l) => l.variantId && l.quantity > 0),
    payments: input.payments.filter((p) => p.paymentTypeId && p.moneyAmount > 0),
  };
}
