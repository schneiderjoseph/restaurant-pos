import { Tables } from '@/api/db/tables.ts';
import type { Order } from '@/api/model/order.ts';
import { OrderStatus } from '@/api/model/order.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
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
  phone?: string;
  credit_limit?: number | null;
  credit_allowed?: boolean | null;
  merged_into?: CustomerRef | unknown;
};

type SettlementRow = {
  amount?: number;
  created_at?: unknown;
  customer?: CustomerRef | unknown;
};

const toDate = (value: unknown): Date | null => {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  try {
    const dt = toLuxonDateTime(value as never);
    return dt.isValid ? dt.toJSDate() : null;
  } catch {
    return null;
  }
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_MS = 86_400_000;

export type CreditAgingBuckets = {
  /** 0–30 days old */
  current: number;
  d31_60: number;
  d61_90: number;
  over90: number;
  /** Age in days of the oldest charge still (partly) unpaid; null when nothing is due. */
  oldestDueDays: number | null;
};

/**
 * Split what a customer still owes by age. Settlements pay the oldest
 * charges first (FIFO), so what remains due is the most recent charges.
 */
export function computeCreditAging(
  charges: Array<{ at: Date | null; amount: number }>,
  settledTotal: number,
  asOf: Date,
): CreditAgingBuckets {
  const buckets: CreditAgingBuckets = { current: 0, d31_60: 0, d61_90: 0, over90: 0, oldestDueDays: null };
  const sorted = [...charges]
    .filter((c) => c.amount > 0)
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  let pool = Math.max(0, settledTotal);
  for (const charge of sorted) {
    const applied = Math.min(pool, charge.amount);
    pool -= applied;
    const remaining = round2(charge.amount - applied);
    if (remaining <= 0.009) continue;
    const days = charge.at ? Math.max(0, Math.floor((asOf.getTime() - charge.at.getTime()) / DAY_MS)) : 0;
    if (buckets.oldestDueDays === null || days > buckets.oldestDueDays) buckets.oldestDueDays = days;
    if (days <= 30) buckets.current += remaining;
    else if (days <= 60) buckets.d31_60 += remaining;
    else if (days <= 90) buckets.d61_90 += remaining;
    else buckets.over90 += remaining;
  }
  buckets.current = round2(buckets.current);
  buckets.d31_60 = round2(buckets.d31_60);
  buckets.d61_90 = round2(buckets.d61_90);
  buckets.over90 = round2(buckets.over90);
  return buckets;
}

/** Surviving customer after merges: a duplicate counts on the keep record. */
export const countedCreditCustomer = (customer?: CustomerRef | null): CustomerRef | undefined => {
  if (!customer) return undefined;
  const keep = customer.merged_into;
  return keep && typeof keep === 'object' ? (keep as CustomerRef) : customer;
};

export type CustomerCreditArRow = {
  customerId: string;
  name: string;
  phone?: string;
  charged: number;
  settled: number;
  due: number;
  /** Number of credit orders counted on the account. */
  orderCount?: number;
  lastChargeAt?: Date | null;
  lastSettlementAt?: Date | null;
  creditLimit?: number | null;
  creditAllowed?: boolean | null;
  aging?: CreditAgingBuckets;
};

export type AggregateCustomerCreditArOptions = {
  /** When false (default), drop rows with due ≈ 0. */
  includeSettled?: boolean;
  /** Reference date for aging (default: now). */
  asOf?: Date;
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
        `SELECT amount, created_at, customer FROM ${Tables.customer_credit_settlements}
         FETCH customer, customer.merged_into`,
      ),
    ),
  ]);

  const rows = new Map<string, CustomerCreditArRow>();
  const chargeEvents = new Map<string, Array<{ at: Date | null; amount: number }>>();

  const ensure = (customer: CustomerRef | undefined): CustomerCreditArRow | null => {
    const customerId = recordIdToString(customer?.id);
    if (!customerId) return null;
    const existing = rows.get(customerId);
    if (existing) return existing;
    const limit = customer?.credit_limit;
    const created: CustomerCreditArRow = {
      customerId,
      name: String(customer?.name ?? '').trim() || customerId,
      phone: customer?.phone ? String(customer.phone) : undefined,
      charged: 0,
      settled: 0,
      due: 0,
      orderCount: 0,
      lastChargeAt: null,
      lastSettlementAt: null,
      creditLimit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null,
      creditAllowed: customer?.credit_allowed ?? null,
    };
    rows.set(customerId, created);
    return created;
  };

  for (const order of orderRows) {
    if (!orderCountsTowardCreditBalance(order)) continue;
    const customer = countedCreditCustomer(order.customer as CustomerRef | undefined);
    const row = ensure(customer);
    if (!row) continue;
    const amount = orderCreditChargeTotal(order);
    row.charged = round2(row.charged + amount);
    row.orderCount = (row.orderCount ?? 0) + 1;
    const at = toDate(order.created_at);
    if (at && (!row.lastChargeAt || at > row.lastChargeAt)) row.lastChargeAt = at;
    const events = chargeEvents.get(row.customerId) ?? [];
    events.push({ at, amount });
    chargeEvents.set(row.customerId, events);
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
    row.settled = round2(row.settled + (Number(settlement.amount) || 0));
    const at = toDate(settlement.created_at);
    if (at && (!row.lastSettlementAt || at > row.lastSettlementAt)) row.lastSettlementAt = at;
  }

  const asOf = options.asOf ?? new Date();
  for (const row of rows.values()) {
    row.due = customerCreditOutstanding(row.charged, row.settled);
    row.aging = computeCreditAging(chargeEvents.get(row.customerId) ?? [], row.settled, asOf);
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
