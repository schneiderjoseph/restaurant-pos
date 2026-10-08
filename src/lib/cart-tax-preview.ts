import { MenuItem } from '@/api/model/cart_item.ts';
import { Order } from '@/api/model/order.ts';
import { OrderItem } from '@/api/model/order_item.ts';
import { Tax } from '@/api/model/tax.ts';
import { calculateOrderTotal } from '@/lib/cart.ts';
import { buildOrderItemPayload } from '@/lib/order-item-pricing.ts';
import { collectOrderTaxRows } from '@/lib/tax-calculator.ts';

export interface CartTotalsPreview {
  /** Net items total, as the order will store it. */
  itemsBase: number;
  taxes: Array<{ tax: Tax; amount: number }>;
  taxTotal: number;
}

const roundAmount = (value: number) => Math.round(value * 100) / 100;

/** The cart as the order it becomes: each line priced the way the order create stores it. */
const cartAsOrder = (cart: MenuItem[]): Order => ({
  items: cart
    .filter((item) => !item.deleted_at)
    .map((item) => {
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
} as Order);

/**
 * Totals shown before a new order is saved. Same rules as the saved order, so the amount the
 * guest sees in the cart is the amount on the Orders screen.
 */
export const previewCartTotals = (
  cart: MenuItem[],
  /** Taxes the new order starts without (the customer's exemptions). */
  excludedTaxIds: string[] = [],
): CartTotalsPreview => {
  const order = { ...cartAsOrder(cart), excluded_taxes: excludedTaxIds } as Order;
  const taxes = collectOrderTaxRows(order, null).filter((row) => row.amount > 0);

  return {
    itemsBase: roundAmount(calculateOrderTotal(order)),
    taxes,
    taxTotal: roundAmount(taxes.reduce((sum, row) => sum + row.amount, 0)),
  };
};
