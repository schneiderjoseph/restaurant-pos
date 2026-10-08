import { describe, expect, it } from 'vitest';
import { MenuItemType, type MenuItem } from '@/api/model/cart_item.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItem } from '@/api/model/order_item.ts';
import type { Tax } from '@/api/model/tax.ts';
import { buildOrderItemPayload } from '@/lib/order-item-pricing.ts';
import {
  calculateOrderPaymentTaxAmount,
  collectOrderTaxRows,
  getOrderTaxableShare,
  getOrderTaxBreakdown,
  getTaxableShare,
} from '@/lib/tax-calculator.ts';

const TVQ = { id: 'tax:tvq', name: 'TVQ', rate: 10 } as unknown as Tax;

const line = (price: number): OrderItem => {
  const pricing = buildOrderItemPayload({
    id: `tmp-${price}`,
    dish: { id: 'menu_item:x', name: 'X', price },
    price,
    quantity: 1,
    newOrOld: MenuItemType.new,
    selectedGroups: [],
    level: 0,
    tax_mode: 'exclusive',
    taxes: [TVQ],
  } as unknown as MenuItem);
  return { price: pricing.price, quantity: 1, modifiers: pricing.modifiers, tax: pricing.tax, taxes: pricing.taxes, tax_mode: 'exclusive' } as OrderItem;
};

/** 100 of items with a 20 cart discount, taxed before or after it. */
const discountedOrder = (treatment: string): Order =>
  ({
    items: [line(60), line(40)],
    tax: null,
    tax_amount: 0,
    discount_amount: 20,
    order_discounts: [{ applied_amount: 20, tax_treatment: treatment }],
  }) as unknown as Order;

describe('tax after discount', () => {
  it('leaves the taxable amount whole by default', () => {
    expect(getTaxableShare(100, 20, 'tax_before_discount')).toBe(1);
    expect(getTaxableShare(100, 20, undefined)).toBe(1);
  });

  it('takes the discounts off the taxable amount', () => {
    expect(getTaxableShare(100, 20, 'tax_after_discount')).toBe(0.8);
    expect(getTaxableShare(100, 150, 'tax_after_discount')).toBe(0);
  });

  it('taxes the full items when the discount is taxed before it', () => {
    const order = discountedOrder('tax_before_discount');
    expect(getOrderTaxableShare(order)).toBe(1);
    expect(calculateOrderPaymentTaxAmount(order, null)).toBe(10);
  });

  it('taxes items minus discounts, the same in payment, stored rows and breakdown', () => {
    const order = discountedOrder('tax_after_discount');
    expect(getOrderTaxableShare(order)).toBe(0.8);
    expect(calculateOrderPaymentTaxAmount(order, null)).toBe(8);
    expect(collectOrderTaxRows(order, null).map((row) => row.amount)).toEqual([8]);
    expect(getOrderTaxBreakdown(order).map((row) => row.amount)).toEqual([8]);
  });
});
