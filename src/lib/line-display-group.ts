import type { MenuItem } from '@/api/model/cart_item.ts';
import { MenuItemType } from '@/api/model/cart_item.ts';
import type { OrderItem, OrderItemModifier } from '@/api/model/order_item.ts';
import { getOrderItemTaxableUnitBase } from '@/lib/cart.ts';
import { safeNumber } from '@/lib/utils.ts';

/** Unit price in cents for display-merge keys (dish + choices). */
export const unitPriceCents = (unit: number): number =>
  Math.round(safeNumber(unit) * 100);

/**
 * Display-only identity for order lines: same dish, oz/variant, seat, note and unit
 * price (including sides). Different oz or different unit price stay separate.
 */
export const orderDisplayGroupKey = (item: OrderItem): string =>
  [
    item.item?.id?.toString?.() ?? '',
    item.variant ?? '',
    item.seat ?? '',
    item.comments ?? '',
    item.category_id ?? item.category ?? '',
    String(unitPriceCents(getOrderItemTaxableUnitBase(item))),
  ].join('\u001f');

/**
 * Group order lines for Commandes / cards: same rules as the cart and guest bill.
 */
export const groupOrderLines = (items: OrderItem[]): OrderItem[][] => {
  const groups: OrderItem[][] = [];
  const byKey = new Map<string, OrderItem[]>();

  for (const item of items) {
    if (item.deleted_at || item.is_refunded === true || item.is_suspended === true) {
      groups.push([item]);
      continue;
    }

    const key = orderDisplayGroupKey(item);
    const group = byKey.get(key);

    if (group) {
      group.push(item);
    } else {
      const created = [item];
      byKey.set(key, created);
      groups.push(created);
    }
  }

  return groups;
};

/** Flatten every chosen side from cart lines (for a flat list under one dish row). */
export const flattenCartGroupModifiers = (items: MenuItem[]): MenuItem[] =>
  items.flatMap((item) =>
    (item.selectedGroups ?? []).flatMap((group) => group.selectedModifiers ?? []),
  );

/** Flatten every chosen side from order lines. */
export const flattenOrderGroupModifiers = (items: OrderItem[]): Array<
  NonNullable<OrderItemModifier['selectedModifiers']>[number]
> =>
  items.flatMap((item) =>
    (item.modifiers ?? []).flatMap((group) => group.selectedModifiers ?? []),
  );

/** True when every line in the group is still pending (quick +/- allowed). */
export const cartGroupIsPending = (items: MenuItem[]): boolean =>
  items.length > 0 && items.every((item) => item.newOrOld === MenuItemType.new);
