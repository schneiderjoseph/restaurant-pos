import {MenuItem, MenuItemType} from "@/api/model/cart_item.ts";
import type { CartModifierGroup } from "@/api/model/cart_item.ts";
import {Order} from "@/api/model/order.ts";
import {OrderItem} from "@/api/model/order_item.ts";
import {DiscountType} from "@/api/model/discount.ts";
import {getOrderFilteredItems} from "@/lib/order.ts";
import {safeNumber} from "@/lib/utils.ts";
import {calculateItemTax} from "@/lib/tax-calculator.ts";

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
  const unitPrice = safeNumber(item?.price ?? item?.dish?.price ?? 0);

  // Handle tax mode for pricing
  let finalUnitPrice = unitPrice;
  if (item?.tax_mode === 'inclusive' && item?.taxes && item.taxes.length > 0) {
    finalUnitPrice = unitPrice;
  } else if (item?.tax_mode === 'exclusive' && item?.taxes && item.taxes.length > 0) {
    const taxCalc = calculateItemTax(unitPrice, item.taxes, 'exclusive');
    finalUnitPrice = taxCalc.gross_price;
  }

  const modifiersUnitTotal = unitBase - unitPrice;
  return (finalUnitPrice + modifiersUnitTotal) * quantity;
}

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

export const calculateOrderTotalsPreview = (order: Order, cart?: MenuItem[]) => {
  const pendingTotal = calculatePendingCartTotal(cart ?? []);
  const pendingCount = getPendingCartItems(cart ?? []).length;
  const itemsTotal = calculateOrderTotal(order) + pendingTotal;
  const itemCount = getOrderFilteredItems(order).length + pendingCount;

  const taxAmount = order?.tax
    ? itemsTotal * order.tax.rate / 100
    : Number(order?.tax_amount ?? 0);

  const serviceChargeAmount = getOrderServiceChargeAmount(order, itemsTotal);

  const discountAmount = order?.discount
    ? order.discount.type === DiscountType.Percent
      ? itemsTotal * Number(order.discount_rate ?? 0) / 100
      : Number(order.discount_amount ?? 0)
    : 0;

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
          `${mod.dish?.id?.toString?.() ?? ''}:${mod.quantity}:${stableGroupsKey(mod.selectedGroups)}`,
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
    item.seat ?? '',
    item.comments ?? '',
    item.category_id ?? item.category ?? '',
    item.menu_name ?? '',
    item.tax_mode ?? '',
    item.isHold ? '1' : '0',
    stableGroupsKey(item.selectedGroups),
  ].join('\u001f');

/**
 * Add to cart: increment quantity when an identical pending line exists,
 * otherwise prepend a new line.
 */
export const mergeCartItem = (cart: MenuItem[], incoming: MenuItem): MenuItem[] => {
  const quantity = Math.max(1, Number(incoming.quantity) || 1);

  if (incoming.newOrOld !== MenuItemType.new || incoming.deleted_at) {
    return [{ ...incoming, quantity, selectedGroups: incoming.selectedGroups ?? [] }, ...cart];
  }

  const key = cartItemMergeKey(incoming);
  const matchIndex = cart.findIndex(
    (line) =>
      !line.deleted_at &&
      line.newOrOld === MenuItemType.new &&
      line.seat === incoming.seat &&
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
