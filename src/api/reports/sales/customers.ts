import type {Order} from "@/api/model/order.ts";
import {getOrderFigures} from "@/api/reports/sales/aggregate.ts";
import {SALES_SUMMARY_FETCHES} from "@/api/reports/sales/fetch.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {CREDIT_SETTLEMENT_TAG} from "@/lib/credit.service.ts";
import {isAnonymousGuest, orderRoomOf} from "@/lib/guest.ts";
import {getOrderPaymentTotals, STAY_SETTLEMENT_TAG} from "@/lib/order.ts";
import {safeNumber} from "@/lib/utils.ts";

/** Orders with no customer, and those of the shared CASH customer, add up on this row. */
export const ANONYMOUS_CUSTOMER_ROW = "anonymous";

export const CUSTOMER_SALES_FETCHES = [...SALES_SUMMARY_FETCHES, "customer", "customer.merged_into"];

export interface CustomerSales {
  /** "customer:…", or ANONYMOUS_CUSTOMER_ROW. */
  customerId: string;
  name?: string;
  room?: string;
  orders: number;
  netSales: number;
  /** Net sales + service charge + tax, tips left out. */
  total: number;
  cash: number;
  otherPayments: number;
  /**
   * Sum of tender amounts matching selected payment types (0 when no filter).
   * Order total/net stay full; this column is the filtered share only.
   */
  filteredPayments: number;
}

export type AggregateSalesByCustomerOptions = {
  /** When set, accumulate matching tender amounts into filteredPayments. */
  paymentTypeIds?: string[];
};

type OrderCustomer = {
  id?: unknown;
  name?: string;
  room?: string | number | null;
  tags?: string[];
  merged_into?: OrderCustomer | unknown;
};

/** Credit / stay settlement tickets are cash collections, not goods sales. */
export const isHouseSettlementOrder = (order?: Pick<Order, "tags"> | null): boolean => {
  const tags = Array.isArray(order?.tags) ? order!.tags.map(String) : [];
  return tags.includes(CREDIT_SETTLEMENT_TAG) || tags.includes(STAY_SETTLEMENT_TAG);
};

/** Drop credit-settlement and stay-settlement Paid shells from sales-by-customer. */
export const excludeHouseSettlementOrders = <T extends Pick<Order, "tags">>(orders: T[]): T[] =>
  orders.filter((order) => !isHouseSettlementOrder(order));

const paymentTypeIdOf = (payment: {payment_type?: unknown} | null | undefined): string => {
  const pt = payment?.payment_type as {id?: unknown} | string | null | undefined;
  if (pt == null) return "";
  if (typeof pt === "string") return pt;
  return recordIdToString(pt.id ?? pt);
};

/** Sum of payment lines whose payment_type id is in the selection. */
export const paymentAmountForTypes = (order: Pick<Order, "payments">, paymentTypeIds: string[]): number => {
  if (!paymentTypeIds.length) return 0;
  const wanted = new Set(paymentTypeIds.map(String));
  return Math.round(
    (order.payments ?? [])
      .filter((payment) => payment != null && wanted.has(paymentTypeIdOf(payment)))
      .reduce((sum, payment) => sum + safeNumber(payment?.amount), 0) * 100,
  ) / 100;
};

/** The customer an order counts for: a merged duplicate counts for the customer it was folded into. */
const countedCustomer = (order: Order): OrderCustomer | undefined => {
  const customer = order.customer as OrderCustomer | undefined;
  const keep = customer?.merged_into;
  return keep && typeof keep === "object" ? keep as OrderCustomer : customer;
};

/**
 * Paid orders summed per customer. The anonymous row comes first, then customers by total.
 * An order whose customer could not be loaded counts as anonymous.
 * Settlement shells (credit / stay) must be excluded by the caller via
 * {@link excludeHouseSettlementOrders}.
 */
export const aggregateSalesByCustomer = (
  orders: Order[],
  options: AggregateSalesByCustomerOptions = {},
): CustomerSales[] => {
  const paymentTypeIds = options.paymentTypeIds ?? [];
  const rows = new Map<string, CustomerSales>();

  orders.forEach((order) => {
    const customer = countedCustomer(order);
    const customerId = recordIdToString(customer?.id);
    const anonymous = !customerId || !customer?.name || isAnonymousGuest(customer);
    const key = anonymous ? ANONYMOUS_CUSTOMER_ROW : customerId;
    const row = rows.get(key) ?? {
      customerId: key,
      name: anonymous ? undefined : customer?.name,
      // A Front Desk (manual) stay is not a hotel room in the reports: ASI rooms only.
      room: anonymous ? undefined : orderRoomOf(customer) || undefined,
      orders: 0,
      netSales: 0,
      total: 0,
      cash: 0,
      otherPayments: 0,
      filteredPayments: 0,
    };

    const figures = getOrderFigures(order);
    const payments = getOrderPaymentTotals(order);
    row.orders += 1;
    row.netSales += safeNumber(figures.netSales);
    row.total += safeNumber(figures.totalRevenue);
    row.cash += safeNumber(payments.cashAmount);
    row.otherPayments += safeNumber(payments.nonCashAmount);
    row.filteredPayments += paymentAmountForTypes(order, paymentTypeIds);
    rows.set(key, row);
  });

  return Array.from(rows.values()).sort((a, b) => {
    if (a.customerId === ANONYMOUS_CUSTOMER_ROW) return -1;
    if (b.customerId === ANONYMOUS_CUSTOMER_ROW) return 1;
    return b.total - a.total;
  });
};
