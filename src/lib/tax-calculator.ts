import { Tax } from "@/api/model/tax.ts";
import { TaxMode } from "@/api/model/menu.ts";
import { OrderItem } from "@/api/model/order_item.ts";
import { Order } from "@/api/model/order.ts";
import { MenuItem } from "@/api/model/cart_item.ts";
import { getOrderFilteredItems } from "@/lib/order.ts";
import { getCartItemTaxableUnitBase, getOrderItemTaxableUnitBase } from "@/lib/cart.ts";
import { safeNumber } from "@/lib/utils.ts";

export interface TaxAmount {
  tax: Tax;
  amount: number;
  rate: number;
}

export interface TaxCalculationResult {
  net_price: number;
  tax_amounts: TaxAmount[];
  total_tax: number;
  gross_price: number;
}

export interface OrderTaxBreakdownEntry {
  name: string;
  rate: number;
  amount: number;
}

/**
 * Calculate tax amounts for an item based on base price, taxes, and tax mode.
 * All taxes are calculated on the base price (cumulative, not compound).
 */
export const calculateItemTax = (
  base_price: number,
  taxes: Tax[],
  tax_mode: TaxMode
): TaxCalculationResult => {
  const validTaxes = (taxes ?? []).filter((tax): tax is Tax => Boolean(tax));

  if (validTaxes.length === 0) {
    return {
      net_price: base_price,
      tax_amounts: [],
      total_tax: 0,
      gross_price: base_price,
    };
  }

  // Inclusive: `base_price` already holds the taxes, each one is taken from the net part
  // (115 with 15 % → 15, not 17.25).
  const totalRate = validTaxes.reduce((sum, tax) => sum + (tax.rate || 0), 0);
  const taxable = tax_mode === 'inclusive' ? base_price / (1 + totalRate / 100) : base_price;

  const tax_amounts: TaxAmount[] = validTaxes.map((tax) => {
    const rate = tax.rate || 0;
    const amount = (taxable * rate) / 100;
    return {
      tax,
      amount: Math.round(amount * 100) / 100,
      rate,
    };
  });

  const total_tax = tax_amounts.reduce((sum, t) => sum + t.amount, 0);
  const gross_price = tax_mode === 'inclusive'
    ? base_price
    : base_price + total_tax;
  const net_price = tax_mode === 'inclusive'
    ? base_price - total_tax
    : base_price;

  return {
    net_price: Math.round(net_price * 100) / 100,
    tax_amounts,
    total_tax: Math.round(total_tax * 100) / 100,
    gross_price: Math.round(gross_price * 100) / 100,
  };
};

/**
 * Back-calculate base price from inclusive display price
 */
export const calculateInclusiveBasePrice = (
  display_price: number,
  taxes: Tax[]
): number => {
  const validTaxes = (taxes ?? []).filter((tax): tax is Tax => Boolean(tax));

  if (validTaxes.length === 0) {
    return display_price;
  }

  const total_tax_rate = validTaxes.reduce((sum, tax) => sum + (tax.rate || 0), 0);
  const divisor = 1 + total_tax_rate / 100;
  const base_price = display_price / divisor;

  return Math.round(base_price * 100) / 100;
};

export const calculateDisplayPrice = (
  base_price: number,
  taxes: Tax[],
  tax_mode: TaxMode
): number => {
  const calculation = calculateItemTax(base_price, taxes, tax_mode);
  return calculation.gross_price;
};

export const formatTaxBreakdown = (tax_amounts: TaxAmount[]): string => {
  if (tax_amounts.length === 0) {
    return '';
  }

  return tax_amounts
    .map((t) => `${t.tax.name} (${t.rate}%): ${t.amount.toFixed(2)}`)
    .join(', ');
};

export const getTotalTaxRate = (taxes: Tax[]): number => {
  const validTaxes = (taxes ?? []).filter((tax): tax is Tax => Boolean(tax));

  if (validTaxes.length === 0) {
    return 0;
  }
  return validTaxes.reduce((sum, tax) => sum + (tax.rate || 0), 0);
};

export const calculateSingleTax = (
  base_price: number,
  tax_rate: number,
  tax_mode: TaxMode
): { net_price: number; tax_amount: number; gross_price: number } => {
  const tax_amount = (base_price * tax_rate) / 100;
  const gross_price = tax_mode === 'inclusive'
    ? base_price
    : base_price + tax_amount;
  const net_price = tax_mode === 'inclusive'
    ? base_price - tax_amount
    : base_price;

  return {
    net_price: Math.round(net_price * 100) / 100,
    tax_amount: Math.round(tax_amount * 100) / 100,
    gross_price: Math.round(gross_price * 100) / 100,
  };
};

const roundTax = (value: number) => Math.round(value * 100) / 100;

const taxIdOf = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'object' && 'id' in value && 'rate' in value) {
    return taxIdOf((value as { id?: unknown }).id);
  }
  return String(value);
};

/** Ids of the taxes removed from this order at payment (`order.excluded_taxes`). */
export const getExcludedTaxIds = (order?: Pick<Order, 'excluded_taxes'> | null): Set<string> =>
  new Set((order?.excluded_taxes ?? []).map(taxIdOf).filter(Boolean));

const withoutExcluded = (taxes: Tax[], excluded?: ReadonlySet<string>): Tax[] =>
  excluded && excluded.size > 0 ? taxes.filter((tax) => !excluded.has(taxIdOf(tax))) : taxes;

/**
 * Taxes added to an exclusive line. A tax chosen at payment (payment type or manual pick)
 * replaces everything; otherwise the line keeps its own menu taxes when it was sold under
 * that rule (`ownTaxes`).
 */
const resolveExclusiveLineTaxes = (
  itemTaxes: Tax[] | undefined | null,
  orderTax: Tax | null | undefined,
  ownTaxes: boolean,
): Tax[] => {
  if (orderTax) {
    return [orderTax];
  }
  if (ownTaxes && itemTaxes && itemTaxes.length > 0) {
    return itemTaxes;
  }
  return [];
};

/**
 * Exclusive order lines stored since taxes apply at order creation carry their tax amount
 * in `order_item.tax`. Older lines stored 0 there and are taxed only by the order tax, so
 * orders paid before that change keep the tax they were actually charged.
 */
export const orderItemCarriesOwnTaxes = (item: OrderItem): boolean => safeNumber(item?.tax) > 0;

const getLineItemTaxCalculation = (
  unitBase: number,
  quantity: number,
  taxMode: TaxMode,
  itemTaxes: Tax[] | undefined | null,
  orderTax?: Tax | null,
): TaxCalculationResult => {
  const qty = safeNumber(quantity || 1);

  if (taxMode === 'inclusive') {
    if (!itemTaxes || itemTaxes.length === 0) {
      return calculateItemTax(0, [], 'inclusive');
    }
    return calculateItemTax(unitBase * qty, itemTaxes, 'inclusive');
  }

  const exclusiveTaxes = resolveExclusiveLineTaxes(itemTaxes, orderTax, true);
  if (exclusiveTaxes.length === 0) {
    return calculateItemTax(0, [], 'exclusive');
  }

  // Taxed on the line amount and rounded once: rounding each unit then multiplying
  // drifts by a cent or more (3 × 2.75 at 9.975 % is 0.82, not 3 × 0.27).
  return calculateItemTax(unitBase * qty, exclusiveTaxes, 'exclusive');
};

/** Order items store inclusive lines as net price + menu taxes (exclusive add). */
const getOrderLineItemTaxCalculation = (
  unitBase: number,
  quantity: number,
  taxMode: TaxMode,
  itemTaxes: Tax[] | undefined | null,
  orderTax: Tax | null | undefined,
  ownTaxes: boolean,
  excluded?: ReadonlySet<string>,
): TaxCalculationResult => {
  const qty = safeNumber(quantity || 1);

  if (taxMode === 'inclusive') {
    const inclusiveTaxes = withoutExcluded(itemTaxes ?? [], excluded);
    if (inclusiveTaxes.length === 0) {
      return calculateItemTax(0, [], 'exclusive');
    }
    return calculateItemTax(unitBase * qty, inclusiveTaxes, 'exclusive');
  }

  const exclusiveTaxes = withoutExcluded(
    resolveExclusiveLineTaxes(itemTaxes, orderTax, ownTaxes),
    excluded,
  );
  if (exclusiveTaxes.length === 0) {
    return calculateItemTax(0, [], 'exclusive');
  }

  // Taxed on the line amount and rounded once: rounding each unit then multiplying
  // drifts by a cent or more (3 × 2.75 at 9.975 % is 0.82, not 3 × 0.27).
  return calculateItemTax(unitBase * qty, exclusiveTaxes, 'exclusive');
};

/**
 * Per-line payment tax: inclusive embedded tax from menu taxes; exclusive lines take the order tax
 * when one is chosen, else their own menu taxes (see `orderItemCarriesOwnTaxes`).
 */
export const calculateOrderItemPaymentTax = (
  item: OrderItem,
  orderTax?: Tax | null,
  excluded?: ReadonlySet<string>,
): number => {
  const taxMode = item.tax_mode ?? 'exclusive';
  const unitBase = getOrderItemTaxableUnitBase(item);
  const quantity = safeNumber(item.quantity || 1);
  const calculation = getOrderLineItemTaxCalculation(
    unitBase,
    quantity,
    taxMode,
    item.taxes,
    orderTax,
    orderItemCarriesOwnTaxes(item),
    excluded,
  );
  return calculation.total_tax;
};

/**
 * Per-line payment tax for pending cart items.
 */
export const calculateCartItemPaymentTax = (
  item: MenuItem,
  orderTax?: Tax | null,
): number => {
  const taxMode = item.tax_mode ?? 'exclusive';
  const unitBase = getCartItemTaxableUnitBase(item);
  const quantity = safeNumber(item.quantity || 1);
  const calculation = getLineItemTaxCalculation(
    unitBase,
    quantity,
    taxMode,
    item.taxes,
    orderTax,
  );
  return calculation.total_tax;
};

/**
 * Taxable (net) line total for cart items — same base settlement uses before exclusive order tax.
 */
export const calculateCartItemsBaseTotal = (cart: MenuItem[]): number => {
  return roundTax(
    cart
      .filter(item => !item.deleted_at)
      .reduce((sum, item) => {
        const quantity = safeNumber(item.quantity || 1);
        return sum + getCartItemTaxableUnitBase(item) * quantity;
      }, 0),
  );
};

/**
 * Cart grand total as if `orderTax` were applied as exclusive % on the whole cart base.
 * Used for pre-order previews so each system tax rate produces a distinct total.
 */
export const calculateCartTotalWithOrderTax = (
  cart: MenuItem[],
  orderTax?: Tax | null,
): number => {
  const base = calculateCartItemsBaseTotal(cart);
  if (!orderTax) {
    return base;
  }
  const rate = safeNumber(orderTax.rate);
  return roundTax(base + (base * rate) / 100);
};

/**
 * Sum of payment taxes for an order and optional pending cart items.
 */
export const calculateOrderPaymentTaxAmount = (
  order: Order,
  orderTax?: Tax | null,
  pendingCart?: MenuItem[],
): number => {
  const orderItems = getOrderFilteredItems(order) ?? [];
  const excluded = getExcludedTaxIds(order);
  let total = orderItems.reduce(
    (sum, item) => sum + calculateOrderItemPaymentTax(item, orderTax, excluded),
    0,
  );

  if (pendingCart) {
    total += pendingCart
      .filter(item => !item.deleted_at)
      .reduce((sum, item) => sum + calculateCartItemPaymentTax(item, orderTax), 0);
  }

  return roundTax(total);
};

/**
 * Canonical order tax total: junction rows when loaded, else stored amount, else computed.
 */
export const getOrderTaxAmount = (order: Order): number => {
  if (order.order_taxes && order.order_taxes.length > 0) {
    return roundTax(order.order_taxes.reduce((sum, row) => sum + safeNumber(row.amount), 0));
  }
  if (order.tax_amount !== undefined && order.tax_amount !== null && order.tax_amount > 0) {
    return safeNumber(order.tax_amount);
  }
  return calculateOrderPaymentTaxAmount(order, order.tax ?? null);
};

/**
 * Per-line tax amount using the same rules as payment.
 */
export const getOrderItemTaxAmount = (item: OrderItem, order: Order): number => {
  return calculateOrderItemPaymentTax(item, order.tax ?? null, getExcludedTaxIds(order));
};

const getOrderItemPaymentTaxBreakdown = (
  item: OrderItem,
  orderTax?: Tax | null,
  excluded?: ReadonlySet<string>,
): TaxAmount[] => {
  const taxMode = item.tax_mode ?? 'exclusive';
  const unitBase = getOrderItemTaxableUnitBase(item);
  const quantity = safeNumber(item.quantity || 1);
  return getOrderLineItemTaxCalculation(
    unitBase,
    quantity,
    taxMode,
    item.taxes,
    orderTax,
    orderItemCarriesOwnTaxes(item),
    excluded,
  ).tax_amounts;
};

const reconcileTaxBreakdownTotal = (
  entries: OrderTaxBreakdownEntry[],
  orderTotal: number,
  order: Order,
): OrderTaxBreakdownEntry[] => {
  if (orderTotal === 0) {
    return entries;
  }

  const computedTotal = roundTax(entries.reduce((sum, entry) => sum + entry.amount, 0));
  const adjustment = roundTax(orderTotal - computedTotal);

  if (adjustment === 0) {
    return entries;
  }

  if (entries.length > 0) {
    const largestIndex = entries.reduce(
      (best, entry, index, list) => (entry.amount > list[best].amount ? index : best),
      0,
    );
    return entries.map((entry, index) => (
      index === largestIndex
        ? {...entry, amount: roundTax(entry.amount + adjustment)}
        : entry
    ));
  }

  return [{
    name: order.tax?.name ?? 'Tax',
    rate: order.tax?.rate ?? 0,
    amount: orderTotal,
  }];
};

/**
 * Aggregated per-tax breakdown for reports and bills.
 * Junction-first: order_taxes rows; legacy item-level compute + reconcile fallback.
 */
export const getOrderTaxBreakdown = (order: Order): OrderTaxBreakdownEntry[] => {
  if (order.order_taxes && order.order_taxes.length > 0) {
    return order.order_taxes.map(row => {
      const tax = typeof row.tax === 'object' && row.tax !== null ? row.tax : null;
      return {
        name: tax?.name ?? 'Tax',
        rate: safeNumber(tax?.rate),
        amount: roundTax(safeNumber(row.amount)),
      };
    });
  }

  const breakdownMap = new Map<string, OrderTaxBreakdownEntry>();
  const orderTax = order.tax ?? null;
  const excluded = getExcludedTaxIds(order);

  (getOrderFilteredItems(order) ?? []).forEach((item) => {
    getOrderItemPaymentTaxBreakdown(item, orderTax, excluded).forEach(({tax, amount}) => {
      const key = `${tax.name} ${tax.rate}%`;
      const existing = breakdownMap.get(key) ?? {name: tax.name, rate: tax.rate || 0, amount: 0};
      existing.amount += amount;
      breakdownMap.set(key, existing);
    });
  });

  const entries = Array.from(breakdownMap.values()).map((entry) => ({
    ...entry,
    amount: roundTax(entry.amount),
  }));

  return reconcileTaxBreakdownTotal(entries, getOrderTaxAmount(order), order);
};

/**
 * Tax rows of an order. `orderTax` left out = the order's stored tax; `null` = no order-level
 * tax (each line keeps its own). Taxes in `order.excluded_taxes` are left out.
 */
export const collectOrderTaxRows = (
  order: Order,
  orderTax?: Tax | null,
): Array<{ tax: Tax; amount: number }> => {
  const breakdownMap = new Map<string, { tax: Tax; amount: number }>();
  const resolvedOrderTax = orderTax === undefined ? order.tax ?? null : orderTax;
  const excluded = getExcludedTaxIds(order);

  (getOrderFilteredItems(order) ?? []).forEach((item) => {
    getOrderItemPaymentTaxBreakdown(item, resolvedOrderTax, excluded).forEach(({ tax, amount }) => {
      const key = tax.id?.toString() ?? `${tax.name}-${tax.rate}`;
      const existing = breakdownMap.get(key) ?? { tax, amount: 0 };
      existing.amount += amount;
      breakdownMap.set(key, existing);
    });
  });

  return Array.from(breakdownMap.values()).map((entry) => ({
    ...entry,
    amount: roundTax(entry.amount),
  }));
};

export const getOrdersTaxBreakdown = (orders: Order[]): OrderTaxBreakdownEntry[] => {
  const breakdownMap = new Map<string, OrderTaxBreakdownEntry>();

  orders.forEach((order) => {
    getOrderTaxBreakdown(order).forEach(({ name, rate, amount }) => {
      const key = `${name} ${rate}%`;
      const existing = breakdownMap.get(key) ?? { name, rate, amount: 0 };
      existing.amount += amount;
      breakdownMap.set(key, existing);
    });
  });

  return Array.from(breakdownMap.values()).map((entry) => ({
    ...entry,
    amount: roundTax(entry.amount),
  }));
};

export const getOrdersTaxTotal = (orders: Order[]): number => {
  return roundTax(orders.reduce((sum, order) => sum + getOrderTaxAmount(order), 0));
};

// Re-export taxable base helpers for consumers that import from tax-calculator
export {getOrderItemTaxableUnitBase, getCartItemTaxableUnitBase} from "@/lib/cart.ts";
