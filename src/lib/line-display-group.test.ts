import { describe, expect, it } from 'vitest';
import { MenuItemType, type MenuItem } from '@/api/model/cart_item.ts';
import type { OrderItem } from '@/api/model/order_item.ts';
import { cartDisplayGroupKey, groupCartLines } from '@/lib/cart.ts';
import { groupOrderLines, orderDisplayGroupKey } from '@/lib/line-display-group.ts';

const cartPlate = (id: string, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  dish: { id: 'menu_item:fish', name: 'Fish' } as never,
  quantity: 1,
  level: 0,
  price: 3860,
  variant: '12 oz',
  newOrOld: MenuItemType.new,
  selectedGroups: [],
  ...extra,
});

const side = (name: string, price = 0) =>
  ({
    id: `mod-${name}`,
    dish: { id: `menu_item:${name}`, name },
    quantity: 1,
    level: 1,
    price,
    newOrOld: MenuItemType.new,
    selectedGroups: [],
  }) as MenuItem;

describe('groupCartLines', () => {
  it('groups same fish + oz with different sides when unit price matches', () => {
    const a = cartPlate('a', {
      selectedGroups: [{ out: { id: 'g1' }, selectedModifiers: [side('Riz')] } as never],
    });
    const b = cartPlate('b', {
      selectedGroups: [{ out: { id: 'g1' }, selectedModifiers: [side('Frites')] } as never],
    });
    expect(cartDisplayGroupKey(a)).toBe(cartDisplayGroupKey(b));
    expect(groupCartLines([a, b]).map((g) => g.map((i) => i.id))).toEqual([['a', 'b']]);
  });

  it('keeps apart different oz', () => {
    const a = cartPlate('a', { variant: '12 oz' });
    const b = cartPlate('b', { variant: '16 oz', price: 3860 * (16 / 12) });
    expect(groupCartLines([a, b])).toHaveLength(2);
  });

  it('keeps apart different unit prices (paid side vs free)', () => {
    const a = cartPlate('a', {
      selectedGroups: [{ out: { id: 'g1' }, selectedModifiers: [side('Riz', 0)] } as never],
    });
    const b = cartPlate('b', {
      selectedGroups: [{ out: { id: 'g1' }, selectedModifiers: [side('Frites', 150)] } as never],
    });
    expect(groupCartLines([a, b])).toHaveLength(2);
  });

  it('groups sent lines the same way as pending', () => {
    const a = cartPlate('a', { newOrOld: MenuItemType.old });
    const b = cartPlate('b', { newOrOld: MenuItemType.old });
    expect(groupCartLines([a, b]).map((g) => g.map((i) => i.id))).toEqual([['a', 'b']]);
  });

  it('keeps voided lines alone', () => {
    const a = cartPlate('a');
    const b = cartPlate('b', { deleted_at: 'x' as never });
    expect(groupCartLines([a, b]).every((g) => g.length === 1)).toBe(true);
  });
});

describe('groupOrderLines', () => {
  const orderPlate = (id: string, extra: Partial<OrderItem> = {}): OrderItem =>
    ({
      id,
      item: { id: 'menu_item:fish', name: 'Fish', price: 3860 },
      price: 3860,
      quantity: 1,
      variant: '12 oz',
      modifiers: [],
      position: 0,
      created_at: '' as never,
      ...extra,
    }) as OrderItem;

  it('groups same dish + oz + unit price', () => {
    const a = orderPlate('1', {
      modifiers: [{
        selectedModifiers: [{ dish: { id: 's:riz', name: 'Riz' }, price: 0, quantity: 1, level: 1 }],
      }] as never,
    });
    const b = orderPlate('2', {
      modifiers: [{
        selectedModifiers: [{ dish: { id: 's:frites', name: 'Frites' }, price: 0, quantity: 1, level: 1 }],
      }] as never,
    });
    expect(orderDisplayGroupKey(a)).toBe(orderDisplayGroupKey(b));
    expect(groupOrderLines([a, b])).toHaveLength(1);
  });

  it('keeps apart different unit prices', () => {
    const a = orderPlate('1', {
      modifiers: [{
        selectedModifiers: [{ dish: { id: 's:riz', name: 'Riz' }, price: 0, quantity: 1, level: 1 }],
      }] as never,
    });
    const b = orderPlate('2', {
      modifiers: [{
        selectedModifiers: [{ dish: { id: 's:frites', name: 'Frites' }, price: 200, quantity: 1, level: 1 }],
      }] as never,
    });
    expect(groupOrderLines([a, b])).toHaveLength(2);
  });
});
