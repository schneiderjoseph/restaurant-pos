import type {Order} from "@/api/model/order.ts";
import {getOrderFigures} from "@/api/reports/sales/aggregate.ts";
import {SALES_SUMMARY_FETCHES} from "@/api/reports/sales/fetch.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {isAnonymousGuest, orderRoomOf} from "@/lib/guest.ts";
import {getOrderPaymentTotals} from "@/lib/order.ts";
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
}

type OrderCustomer = {
  id?: unknown;
  name?: string;
  room?: string | number | null;
  tags?: string[];
  merged_into?: OrderCustomer | unknown;
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
 */
export const aggregateSalesByCustomer = (orders: Order[]): CustomerSales[] => {
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
    };

    const figures = getOrderFigures(order);
    const payments = getOrderPaymentTotals(order);
    row.orders += 1;
    row.netSales += safeNumber(figures.netSales);
    row.total += safeNumber(figures.totalRevenue);
    row.cash += safeNumber(payments.cashAmount);
    row.otherPayments += safeNumber(payments.nonCashAmount);
    rows.set(key, row);
  });

  return Array.from(rows.values()).sort((a, b) => {
    if (a.customerId === ANONYMOUS_CUSTOMER_ROW) return -1;
    if (b.customerId === ANONYMOUS_CUSTOMER_ROW) return 1;
    return b.total - a.total;
  });
};
