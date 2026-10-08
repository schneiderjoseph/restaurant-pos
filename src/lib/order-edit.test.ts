import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@/api/model/order.ts';
import { canEditOrder, splitSentQuantityIncreases } from '@/lib/order-edit.ts';
import { MenuItemType } from '@/api/model/cart_item.ts';

describe('canEditOrder', () => {
  it('allows only In Progress orders', () => {
    expect(canEditOrder({ status: OrderStatus['In Progress'] })).toBe(true);
    expect(canEditOrder({ status: OrderStatus.Paid })).toBe(false);
    expect(canEditOrder({ status: OrderStatus.Cancelled })).toBe(false);
    expect(canEditOrder(null)).toBe(false);
  });
});

describe('splitSentQuantityIncreases', () => {
  const sent = { id: 'order_item:a', quantity: 1, item: { id: 'dish:x', name: 'Fish' }, menu: 'Lunch' } as any;
  const line = (quantity: number) =>
    ({ id: 'order_item:a', quantity, newOrOld: MenuItemType.old, dish: sent.item, level: 0 }) as any;

  it('turns the extra plates of a sent line into a new line', () => {
    const [kept, extra, ...rest] = splitSentQuantityIncreases([sent], [line(3)]);
    expect(rest).toHaveLength(0);
    expect(kept).toMatchObject({ id: 'order_item:a', quantity: 1, newOrOld: MenuItemType.old });
    expect(extra).toMatchObject({ quantity: 2, newOrOld: MenuItemType.new, menu_name: 'Lunch' });
    expect(String(extra.id)).not.toContain('order_item:');
  });

  it('leaves unchanged, lowered and voided lines as they are', () => {
    expect(splitSentQuantityIncreases([sent], [line(1)])).toHaveLength(1);
    expect(splitSentQuantityIncreases([{ ...sent, quantity: 3 }], [line(2)])).toEqual([line(2)]);
    const voided = { ...line(3), deleted_at: 'now' };
    expect(splitSentQuantityIncreases([sent], [voided])).toEqual([voided]);
  });
});
