import {MenuItem, MenuItemType} from "@/api/model/cart_item.ts";
import type { CartModifierGroup } from "@/api/model/cart_item.ts";
import {Order} from "@/api/model/order.ts";
import {OrderItem} from "@/api/model/order_item.ts";
import {DiscountType} from "@/api/model/discount.ts";
import {getOrderFilteredItems} from "@/lib/order.ts";
import {safeNumber} from "@/lib/utils.ts";
import {calculateItemTax, calculateOrderPaymentTaxAmount} from "@/lib/tax-calculator.ts";
import {buildOrderItemPayload} from "@/lib/order-item-pricing.ts";

export const getCartItemTaxableUnitBase = (item: MenuItem): number => {
  const unitPrice = safeNumber(item?.price ?? item?.dish?.price ?? 0);
  const modifiersUnitTotal = (item?.selectedGroups ?? []).reduce((groupsTotal, group) => {
    const selectedModifiers = group?.selectedModifiers ?? [];
    return groupsTotal + selectedModifiers.reduce((modifiersTotal, modifier) => {
      return modifiersTotal + getCartItemTaxableUnitBase(modifier);
    }, 0);
  }, 0);
  return unitPrice + modifiersUnitTotal;
};

export const getOrderItemTaxableUnitBase = (item: OrderItem): number => {
  const unitPrice = safeNumber(item?.price ?? item?.item?.price ?? 0);
  const modifiersUnitTotal = (item?.modifiers ?? []).reduce((groupsTotal, group) => {
    const selectedModifiers = group?.selectedModifiers ?? [];
    return groupsTotal + selectedModifiers.reduce((modifiersTotal, selectedModifier) => {
      if (!selectedModifier) {
        return modifiersTotal;
      }
      return modifiersTotal + getCartItemTaxableUnitBase(selectedModifier);
    }, 0);
  }, 0);
  return unitPrice + modifiersUnitTotal;
};

export const calculateCartItemPrice = (item: MenuItem) => {
  const quantity = safeNumber(item?.quantity || 1);
  const unitBase = getCartItemTaxableUnitBase(item);

  // Exclusive taxes apply to the dish and its choices, as at payment.
  if (item?.tax_mode === 'exclusive' && item?.taxes && item.taxes.length > 0) {
    return calculateItemTax(unitBase, item.taxes, 'exclusive').gross_price * quantity;
  }
  return unitBase * quantity;
}

/** A cart line's amount before taxes: (dish + its choices) × quantity, as shown in the cart. */
export const calculateCartItemNetTotal = (item: MenuItem) =>
  getCartItemTaxableUnitBase(item) * safeNumber(item?.quantity || 1);

export const calculateCartTotal = (items: MenuItem[]) => {
  return items.reduce((prev, item) => calculateCartItemPrice(item) + prev, 0);
}

export const calculateOrderItemPrice = (item: OrderItem) => {
  const quantity = safeNumber(item?.quantity || 1);
  return getOrderItemTaxableUnitBase(item) * quantity;
}

export const calculateOrderTotal = (order?: Order) => {
  let price = 0;
  if (!order) {
    return price;
  }

  for (const item of getOrderFilteredItems(order)) {
    price += calculateOrderItemPrice(item);
  }

  return price;
}

/** Service charge on remaining (non-voided) items. Zero when the order has no items left. */
export const getOrderServiceChargeAmount = (order?: Order, itemsTotal = calculateOrderTotal(order)) => {
  if (!order || itemsTotal <= 0) {
    return 0;
  }

  const rate = Number(order.service_charge ?? 0);
  if (rate <= 0) {
    return 0;
  }

  if (order.service_charge_type === DiscountType.Percent) {
    return itemsTotal * rate / 100;
  }

  return Number(order.service_charge_amount ?? 0);
};

export const calculateOrderExtrasTotal = (order?: Order) => {
  return (order?.extras ?? []).reduce(
    (sum, extra) => sum + safeNumber(extra?.value),
    0,
  );
};

export const calculateExtrasTotalFromRecord = (extras: Record<string, number> | undefined | null) => {
  if (!extras) {
    return 0;
  }
  return Object.values(extras).reduce((prev, value) => prev + Number(value || 0), 0);
};

export interface OrderTotalsInput {
  itemsTotal: number;
  extrasTotal?: number;
  taxAmount?: number;
  discountAmount?: number;
  discountTotal?: number;
  serviceChargeAmount?: number;
  couponAmount?: number;
  tipAmount?: number;
}

export const calculateOrderGrandTotal = ({
  itemsTotal,
  extrasTotal = 0,
  taxAmount = 0,
  discountAmount = 0,
  discountTotal,
  serviceChargeAmount = 0,
  couponAmount = 0,
  tipAmount = 0,
}: OrderTotalsInput) => {
  const resolvedDiscount = discountTotal ?? discountAmount;
  return (
    itemsTotal +
    extrasTotal +
    taxAmount +
    serviceChargeAmount -
    resolvedDiscount -
    couponAmount +
    tipAmount
  );
};

export const calculateChangeDue = (tendered: number, total: number) => {
  return tendered - total;
};

export const getPendingCartItems = (cart: MenuItem[]) =>
  cart.filter(item => !item.deleted_at && item.newOrOld === MenuItemType.new);

export const calculatePendingCartTotal = (cart: MenuItem[]) =>
  getPendingCartItems(cart).reduce((sum, item) => sum + calculateCartItemPrice(item), 0);

/** A pending cart line priced the way it will be saved (net price, menu taxes), as an order line. */
const toPendingOrderItem = (item: MenuItem): OrderItem => {
  const pricing = buildOrderItemPayload(item);
  return {
    ...pricing,
    quantity: item.quantity,
  } as unknown as OrderItem;
};

export const calculateOrderTotalsPreview = (order: Order, cart?: MenuItem[]) => {
  const pendingItems = getPendingCartItems(cart ?? []);
  // Pending lines join the order as they will be stored, so they are taxed by the
  // same rules as the saved ones (and never twice).
  const previewOrder = {
    ...order,
    items: [...(order?.items ?? []), ...pendingItems.map(toPendingOrderItem)],
  } as Order;
  const itemsTotal = calculateOrderTotal(previewOrder);
  const itemCount = getOrderFilteredItems(order).length + pendingItems.length;

  const taxAmount = itemsTotal <= 0 ? 0 : calculateOrderPaymentTaxAmount(previewOrder, order?.tax ?? null);

  const serviceChargeAmount = getOrderServiceChargeAmount(order, itemsTotal);

  const discountAmount = order?.discount && order.discount.type === DiscountType.Percent
    ? itemsTotal * Number(order.discount_rate ?? 0) / 100
    : Number(order?.discount_amount ?? 0);

  const couponAmount = Number(order?.coupon?.discount ?? 0);

  const tipAmount = order?.tip_amount > 0
    ? order.tip_type === DiscountType.Percent
      ? itemsTotal * Number(order.tip ?? 0) / 100
      : Number(order.tip_amount ?? 0)
    : 0;

  const extrasTotal = order?.extras?.filter(item => item !== undefined)?.reduce((prev, item) => prev + item.value, 0) ?? 0;

  const total = calculateOrderGrandTotal({
    itemsTotal,
    extrasTotal,
    taxAmount,
    discountAmount,
    serviceChargeAmount,
    couponAmount,
    tipAmount,
  });

  return {
    itemsTotal,
    itemCount,
    taxAmount,
    serviceChargeAmount,
    discountAmount,
    tipAmount,
    total,
  };
};

const stableGroupsKey = (groups?: CartModifierGroup[]): string => {
  if (!groups?.length) return '';
  return groups
    .map((group) => {
      const mods = (group.selectedModifiers ?? [])
        .map((mod) =>
          // Price too: the same sides can be free on one line and charged on another.
          `${mod.dish?.id?.toString?.() ?? ''}:${mod.quantity}:${safeNumber(mod.price)}:${stableGroupsKey(mod.selectedGroups)}`,
        )
        .sort()
        .join(',');
      return `${group.out?.id?.toString?.() ?? ''}:${mods}`;
    })
    .join('|');
};

/** Identity key for merging identical new cart lines (same dish, seat, modifiers, comment). */
export const cartItemMergeKey = (item: MenuItem): string =>
  [
    item.dish?.id?.toString?.() ?? '',
    item.variant ?? '',
    item.seat ?? '',
    item.comments ?? '',
    item.category_id ?? item.category ?? '',
    item.menu_name ?? '',
    item.tax_mode ?? '',
    item.isHold ? '1' : '0',
    stableGroupsKey(item.selectedGroups),
  ].join('\u001f');

/**
 * Display identity: same dish, oz/variant, seat, note, hold and unit price (dish +
 * sides). Different oz or different unit price stay separate. Storage stays one
 * line per plate when sides differ (`mergeCartItem` / DB).
 */
export const cartDisplayGroupKey = (item: MenuItem): string =>
  [
    item.dish?.id?.toString?.() ?? '',
    item.variant ?? '',
    item.seat ?? '',
    item.comments ?? '',
    item.category_id ?? item.category ?? '',
    item.menu_name ?? '',
    item.tax_mode ?? '',
    item.isHold ? '1' : '0',
    String(Math.round(getCartItemTaxableUnitBase(item) * 100)),
  ].join('\u001f');

/**
 * Display-only: one cart row per dish+oz+unit price, sides listed under it.
 * Voided lines stay alone. Pending and sent lines can share a group.
 */
export const groupCartLines = (items: MenuItem[]): MenuItem[][] => {
  const groups: MenuItem[][] = [];
  const byKey = new Map<string, MenuItem[]>();

  for (const item of items) {
    if (item.deleted_at) {
      groups.push([item]);
      continue;
    }

    const key = cartDisplayGroupKey(item);
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

/**
 * Add to cart: increment quantity when an identical pending line exists,
 * otherwise prepend a new line.
 * When `mergeWithOld` is true (order edit), also bump matching persisted lines
 * so we don't create a second "new" block separated by the cart divider.
 */
export const mergeCartItem = (
  cart: MenuItem[],
  incoming: MenuItem,
  options?: { mergeWithOld?: boolean },
): MenuItem[] => {
  const quantity = Math.max(1, Number(incoming.quantity) || 1);

  if (incoming.newOrOld !== MenuItemType.new || incoming.deleted_at) {
    return [{ ...incoming, quantity, selectedGroups: incoming.selectedGroups ?? [] }, ...cart];
  }

  const key = cartItemMergeKey(incoming);
  const mergeWithOld = options?.mergeWithOld === true;
  const matchIndex = cart.findIndex(
    (line) =>
      !line.deleted_at &&
      (line.newOrOld === MenuItemType.new ||
        (mergeWithOld && line.newOrOld === MenuItemType.old)) &&
      String(line.seat ?? '') === String(incoming.seat ?? '') &&
      cartItemMergeKey(line) === key,
  );

  if (matchIndex >= 0) {
    return cart.map((line, index) =>
      index === matchIndex
        ? { ...line, quantity: Number(line.quantity || 1) + quantity }
        : line,
    );
  }

  return [
    { ...incoming, quantity, selectedGroups: incoming.selectedGroups ?? [] },
    ...cart,
  ];
};
