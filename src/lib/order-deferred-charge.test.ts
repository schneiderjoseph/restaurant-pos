import { describe, expect, it } from 'vitest';
import {
  ORDER_FILTER_CREDIT,
  ORDER_FILTER_ROOM,
  orderDeferredCharges,
  orderStatusFilterClause,
} from '@/lib/order-deferred-charge.ts';

describe('orderDeferredCharges', () => {
  it('returns empty when the order is still open', () => {
    expect(orderDeferredCharges({
      status: 'In Progress',
      payments: [{ payment_type: { type: 'Room' } }],
    })).toEqual([]);
  });

  it('detects Room on a Paid order', () => {
    expect(orderDeferredCharges({
      status: 'Paid',
      payments: [{ payment_type: { type: 'Room' } }],
    })).toEqual(['room']);
  });

  it('detects Credit on a Paid order', () => {
    expect(orderDeferredCharges({
      status: 'Paid',
      payments: [{ payment_type: { type: 'Credit' } }],
    })).toEqual(['credit']);
  });

  it('lists both when mixed', () => {
    expect(orderDeferredCharges({
      status: 'Paid',
      payments: [
        { payment_type: { type: 'Room' } },
        { payment_type: { type: 'Credit' } },
      ],
    })).toEqual(['room', 'credit']);
  });

  it('ignores cash/card Paid orders', () => {
    expect(orderDeferredCharges({
      status: 'Paid',
      payments: [{ payment_type: { type: 'Cash' } }],
    })).toEqual([]);
  });
});

describe('orderStatusFilterClause', () => {
  it('builds Room / Credit deferred filters and plain status equality', () => {
    expect(orderStatusFilterClause(ORDER_FILTER_ROOM)).toContain('Room');
    expect(orderStatusFilterClause(ORDER_FILTER_CREDIT)).toContain('Credit');
    expect(orderStatusFilterClause('Paid')).toBe('status = "Paid"');
  });
});

