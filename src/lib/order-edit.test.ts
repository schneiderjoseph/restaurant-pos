import { describe, expect, it } from 'vitest';
import { OrderStatus } from '@/api/model/order.ts';
import { canEditOrder, orderToCartItems, splitSentQuantityIncreases } from '@/lib/order-edit.ts';
import { buildOrderItemPayload } from '@/lib/order-item-pricing.ts';
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

describe('orderToCartItems', () => {
  const tca = { id: 'tax:asi_10', name: 'TCA', rate: 10 };
  const service = { id: 'tax:asi_5', name: 'SERVICE', rate: 5 };

  it('keeps the taxes of a sent line, so saving an edit does not zero its tax', () => {
    const [line] = orderToCartItems({
      items: [{ id: 'order_item:a', item: { name: 'Prestige' }, price: 430, quantity: 2, taxes: [tca, service], tax_mode: 'exclusive' }],
    } as any);
    expect(buildOrderItemPayload(line).tax).toBe(129);
  });

  it('prices an inclusive line from its menu price, not its stored net price', () => {
    const [line] = orderToCartItems({
      items: [{ id: 'order_item:a', item: { name: 'Plat' }, price: 100, original_price: 115, quantity: 1, taxes: [tca, service], tax_mode: 'inclusive' }],
    } as any);
    const pricing = buildOrderItemPayload(line);
    expect(pricing.price).toBe(100);
    expect(pricing.tax).toBe(15);
  });

  it('ignores taxes that were not fetched', () => {
    const [line] = orderToCartItems({
      items: [{ id: 'order_item:a', item: { name: 'Plat' }, price: 100, quantity: 1, taxes: ['tax:asi_10'] }],
    } as any);
    expect(line.taxes).toBeUndefined();
  });
});
