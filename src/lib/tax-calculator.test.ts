import { describe, expect, it } from 'vitest';
import { MenuItemType, type MenuItem } from '@/api/model/cart_item.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItem } from '@/api/model/order_item.ts';
import type { Tax } from '@/api/model/tax.ts';
import { buildOrderItemPayload } from '@/lib/order-item-pricing.ts';
import { previewCartTotals } from '@/lib/cart-tax-preview.ts';
import {
  calculateOrderPaymentTaxAmount,
  collectOrderTaxRows,
  getOrderTaxAmount,
} from '@/lib/tax-calculator.ts';

const TCA = { id: 'tax:asi_10', name: 'TCA', rate: 10, priority: 1 } as unknown as Tax;
const SERVICE = { id: 'tax:asi_5', name: 'Services Charges', rate: 5, priority: 2 } as unknown as Tax;
const CARD = { id: 'tax:card', name: 'Card', rate: 12, priority: 3 } as unknown as Tax;

const cartLine = (overrides: Partial<MenuItem> = {}): MenuItem =>
  ({
    id: `tmp-${Math.random()}`,
    dish: { id: 'menu_item:burger', name: 'Burger', price: 100 },
    price: 100,
    quantity: 1,
    newOrOld: MenuItemType.new,
    selectedGroups: [],
    level: 0,
    tax_mode: 'exclusive',
    taxes: [TCA, SERVICE],
    ...overrides,
  }) as MenuItem;

/** What the order create in payment.tsx stores for these cart lines. */
const savedOrder = (cart: MenuItem[], overrides: Partial<Order> = {}): Order =>
  ({
    items: cart.map((item) => {
      const pricing = buildOrderItemPayload(item);
      return {
        price: pricing.price,
        quantity: item.quantity,
        modifiers: pricing.modifiers,
        tax: pricing.tax,
        taxes: pricing.taxes,
        tax_mode: pricing.tax_mode,
        is_suspended: item.isHold,
      } as OrderItem;
    }),
    tax: null,
    tax_amount: 0,
    ...overrides,
  }) as unknown as Order;

describe('taxes from order creation', () => {
  it('applies each exclusive line its own menu taxes in the cart', () => {
    const preview = previewCartTotals([cartLine({ quantity: 2 })]);

    expect(preview.itemsBase).toBe(200);
    expect(preview.taxes.map((row) => [row.tax.name, row.amount])).toEqual([
      ['TCA', 20],
      ['Services Charges', 10],
    ]);
    expect(preview.taxTotal).toBe(30);
  });

  it('keeps the cart tax once the order is saved, before any payment', () => {
    const cart = [cartLine({ quantity: 2 }), cartLine({ price: 50, taxes: [TCA] })];
    const preview = previewCartTotals(cart);
    const order = savedOrder(cart);

    expect(calculateOrderPaymentTaxAmount(order, null)).toBe(preview.taxTotal);
    expect(getOrderTaxAmount(order)).toBe(preview.taxTotal);
    expect(preview.taxTotal).toBe(35);
  });

  it('only charges a line the taxes it carries, not every tax in the system', () => {
    const preview = previewCartTotals([cartLine({ taxes: [TCA] }), cartLine({ taxes: [] })]);

    expect(preview.taxes.map((row) => [row.tax.name, row.amount])).toEqual([['TCA', 10]]);
  });

  it('stores the line tax on exclusive lines', () => {
    expect(buildOrderItemPayload(cartLine({ quantity: 3 })).tax).toBe(45);
    expect(buildOrderItemPayload(cartLine({ taxes: [] })).tax).toBe(0);
  });

  it('lets a tax chosen at payment replace the line taxes', () => {
    const order = savedOrder([cartLine()]);

    expect(calculateOrderPaymentTaxAmount(order, CARD)).toBe(12);
    expect(collectOrderTaxRows(order, CARD).map((row) => row.tax.name)).toEqual(['Card']);
  });

  it('leaves lines stored before the change taxed by the order tax only', () => {
    const legacy = {
      items: [{ price: 100, quantity: 1, tax: 0, taxes: [TCA, SERVICE], tax_mode: 'exclusive' }],
      tax: null,
      tax_amount: 0,
    } as unknown as Order;

    expect(calculateOrderPaymentTaxAmount(legacy, null)).toBe(0);
    expect(collectOrderTaxRows(legacy, null)).toEqual([]);
  });

  it('does not tax held lines, as the saved order does not', () => {
    const preview = previewCartTotals([cartLine(), cartLine({ isHold: true })]);

    expect(preview.itemsBase).toBe(100);
    expect(preview.taxTotal).toBe(15);
  });

  it('shows inclusive lines net of their tax, matching the saved order', () => {
    const cart = [cartLine({ price: 115, tax_mode: 'inclusive' })];
    const preview = previewCartTotals(cart);

    expect(preview.itemsBase).toBe(100);
    expect(preview.taxTotal).toBe(15);
    expect(getOrderTaxAmount(savedOrder(cart))).toBe(15);
  });
});
