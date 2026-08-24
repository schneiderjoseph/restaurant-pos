import { describe, expect, it } from 'vitest';
import { MenuItemType, type MenuItem } from '@/api/model/cart_item.ts';
import { cartItemMergeKey, mergeCartItem } from '@/lib/cart.ts';

const baseItem = (overrides: Partial<MenuItem> = {}): MenuItem =>
  ({
    id: `tmp-${Math.random()}`,
    dish: { id: 'dish:1', name: 'Burger', price: 10 },
    quantity: 1,
    seat: 1,
    newOrOld: MenuItemType.new,
    selectedGroups: [],
    level: 0,
    ...overrides,
  }) as MenuItem;

describe('mergeCartItem', () => {
  it('increments quantity when the same dish is added again', () => {
    const existing = baseItem({ id: 'line-1' });
    const incoming = baseItem({ id: 'line-2' });

    const next = mergeCartItem([existing], incoming);

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe('line-1');
    expect(next[0].quantity).toBe(2);
  });

  it('keeps separate lines when modifiers differ', () => {
    const existing = baseItem({
      id: 'line-1',
      selectedGroups: [
        {
          out: { id: 'mod-group:1' },
          selectedModifiers: [{ dish: { id: 'dish:extra' }, quantity: 1, level: 1, selectedGroups: [] }],
        },
      ] as MenuItem['selectedGroups'],
    });
    const incoming = baseItem({ id: 'line-2', selectedGroups: [] });

    const next = mergeCartItem([existing], incoming);

    expect(next).toHaveLength(2);
    expect(next[0].id).toBe('line-2');
    expect(next[1].id).toBe('line-1');
  });

  it('keeps separate lines when comments differ', () => {
    const existing = baseItem({ id: 'line-1', comments: 'no onions' });
    const incoming = baseItem({ id: 'line-2', comments: '' });

    expect(mergeCartItem([existing], incoming)).toHaveLength(2);
  });

  it('does not merge persisted (old) lines', () => {
    const existing = baseItem({ id: 'line-1', newOrOld: MenuItemType.old });
    const incoming = baseItem({ id: 'line-2' });

    const next = mergeCartItem([existing], incoming);

    expect(next).toHaveLength(2);
    expect(next[0].id).toBe('line-2');
    expect(next[1].id).toBe('line-1');
  });
});

describe('cartItemMergeKey', () => {
  it('is stable for identical items', () => {
    const a = baseItem({ comments: 'extra sauce' });
    const b = baseItem({ id: 'other', comments: 'extra sauce' });
    expect(cartItemMergeKey(a)).toBe(cartItemMergeKey(b));
  });
});
