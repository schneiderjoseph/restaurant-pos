import { Tables } from '@/api/db/tables.ts';
import type { Order } from '@/api/model/order.ts';
import { OrderStatus } from '@/api/model/order.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';
import type { DbClient } from '@/api/reports/shared/types.ts';
import { CREDIT_PAYMENT_TYPE } from '@/lib/credit-charge.ts';
import {
  customerCreditFolioTotal,
  customerCreditOutstanding,
  orderCountsTowardCreditBalance,
  orderCreditChargeTotal,
} from '@/lib/credit.service.ts';

const rowsOf = <T>(result: unknown): T[] => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? (first as T[]) : [];
};

/** Fetches needed for pure AR helpers (refund cap + credit tender). */
const CREDIT_AR_ORDER_FETCHES = [
  'customer',
  'customer.merged_into',
  'items',
  'payments',
  'payments.payment_type',
  'extras',
  'extras.order_extras',
  'order_discounts',
  'order_discounts.discount',
  'coupon',
  'coupon.coupon',
  'tax',
  'order_taxes',
  'order_taxes.tax',
].join(', ');

type CustomerRef = {
  id?: unknown;
  name?: string;
  merged_into?: CustomerRef | unknown;
};

type SettlementRow = {
  amount?: number;
  customer?: CustomerRef | unknown;
};

/** Surviving customer after merges: a duplicate counts on the keep record. */
export const countedCreditCustomer = (customer?: CustomerRef | null): CustomerRef | undefined => {
  if (!customer) return undefined;
  const keep = customer.merged_into;
  return keep && typeof keep === 'object' ? (keep as CustomerRef) : customer;
};

export type CustomerCreditArRow = {
  customerId: string;
  name: string;
  charged: number;
  settled: number;
  due: number;
};

export type AggregateCustomerCreditArOptions = {
  /** When false (default), drop rows with due ≈ 0. */
  includeSettled?: boolean;
};

/**
 * House-account AR snapshot for every customer with credit activity.
 * Does not filter on credit_allowed — revoked accounts that still owe stay visible.
 * Totals use the pure helpers from credit.service (no duplicated AR math).
 */
export async function aggregateCustomerCreditAr(
  db: DbClient,
  options: AggregateCustomerCreditArOptions = {},
): Promise<CustomerCreditArRow[]> {
  const includeSettled = options.includeSettled === true;

  const [orderRows, settlementRows] = await Promise.all([
    rowsOf<Order>(
      await db.query(
        `SELECT * FROM ${Tables.orders}
         WHERE deleted_at = none
           AND status = $paid
           AND payments.payment_type.type CONTAINSANY [$credit]
         ORDER BY created_at ASC
         FETCH ${CREDIT_AR_ORDER_FETCHES}`,
        { paid: OrderStatus.Paid, credit: CREDIT_PAYMENT_TYPE },
      ),
    ),
    rowsOf<SettlementRow>(
      await db.query(
        `SELECT amount, customer FROM ${Tables.customer_credit_settlements}
         FETCH customer, customer.merged_into`,
      ),
    ),
  ]);

  const rows = new Map<string, CustomerCreditArRow>();

  const ensure = (customer: CustomerRef | undefined): CustomerCreditArRow | null => {
    const customerId = recordIdToString(customer?.id);
    if (!customerId) return null;
    const existing = rows.get(customerId);
    if (existing) return existing;
    const created: CustomerCreditArRow = {
      customerId,
      name: String(customer?.name ?? '').trim() || customerId,
      charged: 0,
      settled: 0,
      due: 0,
    };
    rows.set(customerId, created);
    return created;
  };

  for (const order of orderRows) {
    if (!orderCountsTowardCreditBalance(order)) continue;
    const customer = countedCreditCustomer(order.customer as CustomerRef | undefined);
    const row = ensure(customer);
    if (!row) continue;
    row.charged = Math.round((row.charged + orderCreditChargeTotal(order)) * 100) / 100;
    if (customer?.name && row.name === row.customerId) {
      row.name = String(customer.name).trim();
    }
  }

  for (const settlement of settlementRows) {
    const customer = countedCreditCustomer(
      settlement.customer && typeof settlement.customer === 'object'
        ? (settlement.customer as CustomerRef)
        : undefined,
    );
    const row = ensure(customer);
    if (!row) continue;
    row.settled = Math.round((row.settled + (Number(settlement.amount) || 0)) * 100) / 100;
  }

  for (const row of rows.values()) {
    row.due = customerCreditOutstanding(row.charged, row.settled);
  }

  const list = Array.from(rows.values())
    .filter((row) => includeSettled || row.due > 0.009)
    .sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));

  return list;
}

/** Sanity: folio total from orders matches sum of per-order charges. */
export function creditArChargedFromOrders(orders: Order[]): number {
  return customerCreditFolioTotal(orders);
}
