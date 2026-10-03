import { describe, expect, it } from 'vitest';
import { seesAllOrders, SEES_ALL_ORDERS_MODULE, withSeeAllOrders } from '@/api/model/order_visibility.ts';

describe('seesAllOrders', () => {
  it('shows every order to everyone while the switch is off', () => {
    expect(seesAllOrders(false, false)).toBe(true);
    expect(seesAllOrders(false, true)).toBe(true);
  });

  it('limits a user to their own orders once it is on, unless their role sees all', () => {
    expect(seesAllOrders(true, false)).toBe(false);
    expect(seesAllOrders(true, true)).toBe(true);
  });
});

describe('withSeeAllOrders', () => {
  it('adds the permission once and keeps the other modules', () => {
    expect(withSeeAllOrders(['orders', 'menu'], true)).toEqual(['orders', 'menu', SEES_ALL_ORDERS_MODULE]);
    expect(withSeeAllOrders(['orders', SEES_ALL_ORDERS_MODULE], true)).toEqual(['orders', SEES_ALL_ORDERS_MODULE]);
  });

  it('removes it without touching the rest', () => {
    expect(withSeeAllOrders(['orders', SEES_ALL_ORDERS_MODULE, 'menu'], false)).toEqual(['orders', 'menu']);
    expect(withSeeAllOrders(undefined, false)).toEqual([]);
  });
});
