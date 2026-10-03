import { describe, expect, it } from 'vitest';
import { formatElapsed, formatOrderNumber } from '@/lib/order.ts';
import type { Order } from '@/api/model/order.ts';

const order = (invoice_number?: number | null, split?: number): Order =>
  ({ invoice_number, split }) as Order;

describe('formatOrderNumber', () => {
  it('returns dash when invoice_number is nullish', () => {
    expect(formatOrderNumber(null)).toBe('-');
    expect(formatOrderNumber(undefined)).toBe('-');
    expect(formatOrderNumber(order(null))).toBe('-');
    expect(formatOrderNumber(order(undefined))).toBe('-');
  });

  it('pads to at least 3 digits with a # prefix', () => {
    expect(formatOrderNumber(order(7))).toBe('#007');
    expect(formatOrderNumber(order(12))).toBe('#012');
    expect(formatOrderNumber(order(1534))).toBe('#1534');
  });

  it('keeps the split suffix', () => {
    expect(formatOrderNumber(order(12, 2))).toBe('#012/2');
  });
});

describe('formatElapsed', () => {
  it('formats under one hour as minutes', () => {
    expect(formatElapsed(0)).toBe('0 min');
    expect(formatElapsed(18)).toBe('18 min');
    expect(formatElapsed(59)).toBe('59 min');
  });

  it('formats one hour and more as h + zero-padded minutes', () => {
    expect(formatElapsed(60)).toBe('1 h 00');
    expect(formatElapsed(65)).toBe('1 h 05');
    expect(formatElapsed(125)).toBe('2 h 05');
  });

  it('floors fractional and clamps negative minutes', () => {
    expect(formatElapsed(18.9)).toBe('18 min');
    expect(formatElapsed(-3)).toBe('0 min');
  });
});
