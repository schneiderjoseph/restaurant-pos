import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@/api/model/order.ts';
import { canEditOrder } from '@/lib/order-edit.ts';

describe('canEditOrder', () => {
  it('allows only In Progress orders', () => {
    expect(canEditOrder({ status: OrderStatus['In Progress'] })).toBe(true);
    expect(canEditOrder({ status: OrderStatus.Paid })).toBe(false);
    expect(canEditOrder({ status: OrderStatus.Cancelled })).toBe(false);
    expect(canEditOrder(null)).toBe(false);
  });
});
