import {describe, expect, it} from 'vitest';
import {RecordId} from 'surrealdb';
import type {OrderItem} from '@/api/model/order_item.ts';
import {canCarveUnit, carveUnit, linesRatio, linkOrText, partLines} from '@/lib/order-split.ts';
import {soldQuantity} from '@/lib/order.ts';

const line = (id: string, quantity: number, price = 100) =>
  ({id: new RecordId('order_item', id), quantity, price, modifiers: []}) as unknown as OrderItem;

describe('carving units off a line', () => {
  it('only carves a whole line of two units or more', () => {
    expect(canCarveUnit(line('a', 1))).toBe(false);
    expect(canCarveUnit(line('a', 2))).toBe(true);
    const [, piece] = carveUnit(line('a', 3));
    expect(canCarveUnit(piece)).toBe(false);
  });

  it('leaves one unit less on the line and gives the unit its own line', () => {
    const [rest, piece] = carveUnit(line('a', 3));
    expect(rest.quantity).toBe(2);
    expect(String(rest.id)).toBe('order_item:a');
    expect(piece.quantity).toBe(1);
    expect(String(piece.id)).toMatch(/^order_item:a~/);
  });

  it('hands whole lines and carved units to commitSplit separately', () => {
    const [rest, piece] = carveUnit(line('a', 3));
    const parts = partLines([rest, line('b', 1), piece]);
    expect(parts.itemIds?.map(String)).toEqual(['order_item:a', 'order_item:b']);
    expect(parts.pieces).toEqual([{sourceId: 'order_item:a', quantity: 1}]);
  });

  it('shares the order by the carved quantities', () => {
    const [rest, piece] = carveUnit(line('a', 4));
    expect(linesRatio([piece], [rest, piece], 2)).toBeCloseTo(0.25);
  });
});

describe('record-or-text fields', () => {
  it('keeps a plain string and links a record id', () => {
    expect(linkOrText('restaurant')).toBe('restaurant');
    expect(String(linkOrText(new RecordId('outlet', 'bar')))).toBe('outlet:bar');
  });
});

describe('soldQuantity', () => {
  it('counts a split-by-amount copy for its share of the units', () => {
    expect(soldQuantity(line('a', 2))).toBe(2);
    expect(soldQuantity({...line('a', 2), split_share: 0.5} as OrderItem)).toBe(1);
  });
});
