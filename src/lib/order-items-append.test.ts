import { describe, expect, it } from 'vitest';
import { unionOrderItemIds } from '@/lib/order-items-append.ts';

describe('unionOrderItemIds', () => {
  it('keeps lines already on the order when appending a later cart', () => {
    // Order 899: Maurice's drinks must survive Gammanuel's food add.
    const existing = [
      'order_item:plage',
      'order_item:gingerale',
      'order_item:glenfiddich',
      'order_item:daiquiri',
      'order_item:prestige',
      'order_item:heineken',
      'order_item:citron',
    ];
    const fromLaterCart = ['order_item:plage', 'order_item:langouste', 'order_item:lambi'];

    expect(unionOrderItemIds(existing, fromLaterCart.filter((id) => !existing.includes(id)))).toEqual([
      ...existing,
      'order_item:langouste',
      'order_item:lambi',
    ]);
  });

  it('does not duplicate ids already present', () => {
    expect(
      unionOrderItemIds(['order_item:a', 'order_item:b'], ['order_item:b', 'order_item:c']),
    ).toEqual(['order_item:a', 'order_item:b', 'order_item:c']);
  });

  it('returns existing unchanged when nothing new', () => {
    expect(unionOrderItemIds(['order_item:a'], [])).toEqual(['order_item:a']);
  });
});
