import { describe, expect, it } from 'vitest';
import { getOrderPaymentTotals, getOrderRounding } from '@/lib/order.ts';

describe('getOrderPaymentTotals deferred charges', () => {
  it('keeps Cash/Card in amountCollected and Room/Credit in deferred', () => {
    const totals = getOrderPaymentTotals({
      payments: [
        { amount: 100, payable: 300, payment_type: { type: 'Cash', name: 'CASH' } },
        { amount: 50, payable: 300, payment_type: { type: 'Card', name: 'CARD' } },
        { amount: 80, payable: 300, payment_type: { type: 'Room', name: 'ROOM' } },
        { amount: 70, payable: 300, payment_type: { type: 'Credit', name: 'CREDIT' } },
      ],
    } as never);

    expect(totals.cashAmount).toBe(100);
    expect(totals.nonCashAmount).toBe(50);
    expect(totals.amountCollected).toBe(150);
    expect(totals.roomAmount).toBe(80);
    expect(totals.creditAmount).toBe(70);
    expect(totals.deferredAmount).toBe(150);
    expect(totals.amountApplied).toBe(300);
    expect(totals.nonCashBreakdown).toEqual({ CARD: 50 });
    expect(totals.deferredBreakdown).toEqual({ ROOM: 80, CREDIT: 70 });
  });

  it('does not count a Credit-only check as till money', () => {
    const totals = getOrderPaymentTotals({
      payments: [
        { amount: 19205, payable: 19205, payment_type: { type: 'Credit', name: 'CREDIT' } },
      ],
    } as never);
    expect(totals.amountCollected).toBe(0);
    expect(totals.creditAmount).toBe(19205);
    expect(totals.amountApplied).toBe(19205);
  });

  it('rounds against amountApplied so Room/Credit checks are not short', () => {
    const order = {
      payments: [
        { amount: 100, payable: 100, payment_type: { type: 'Room', name: 'ROOM' } },
      ],
      items: [],
      tip_amount: 0,
      service_charge_amount: 0,
      tax_amount: 0,
      discount_amount: 0,
    };
    expect(getOrderRounding(order as never)).toBe(0);
  });
});
