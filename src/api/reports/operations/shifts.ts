import {Tables} from "@/api/db/tables.ts";
import type {Order} from "@/api/model/order.ts";
import type {TimeEntry} from "@/api/model/time_entry.ts";
import {buildCreatedAtDateConditions, unwrapQueryResult} from "@/api/reports/shared/query.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import type {DateRangeFilter, DbClient} from "@/api/reports/shared/types.ts";
import {toJsDate} from "@/lib/datetime.ts";
import {getOrderPaymentTotals} from "@/lib/order.ts";
import {safeNumber} from "@/lib/utils.ts";

/**
 * Shift report (ASI "Shift Report for All Desk Users"): one row per clock-in
 * session with what the employee collected during it. A paid order counts for
 * the person who took the payment (cashier, else the order taker) and for the
 * session of that person that was open when the order was created. Paid orders
 * with no matching session land on an "outside session" row for that person,
 * so the report totals always match the period's paid orders.
 */
export type ShiftRow = {
  key: string;
  userId: string;
  userName: string;
  role?: string;
  /** null for the "outside session" row. */
  clockIn: Date | null;
  clockOut: Date | null;
  active: boolean;
  durationSeconds: number;
  checks: number;
  guests: number;
  netSales: number;
  cash: number;
  otherTenders: Record<string, number>;
  otherTotal: number;
  collected: number;
  /** Room + house credit charges: sold but not money in the till. */
  deferred: number;
  tips: number;
};

type PersonRef = {id?: unknown; first_name?: string; last_name?: string; login?: string; user_role?: {name?: string}};

const personName = (u?: PersonRef | null): string => {
  if (!u || typeof u !== "object") return "";
  return `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() || u.login || "";
};

const toTime = (value: unknown): number | null => {
  if (value == null) return null;
  try {
    const t = toJsDate(value as Parameters<typeof toJsDate>[0]).getTime();
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
};

/** Net sales: everything applied to the order (till + room/credit) minus service, tax and tips. */
const orderNetSales = (order: Order, applied: number) =>
  safeNumber(applied - safeNumber(order.service_charge_amount) - safeNumber(order.tax_amount) - safeNumber(order.tip_amount));

export function buildShiftRows(entries: TimeEntry[], orders: Order[], now: Date = new Date()): ShiftRow[] {
  const rows = new Map<string, ShiftRow>();
  const sessionsByUser = new Map<string, Array<{key: string; from: number; to: number}>>();

  const blank = (key: string, userId: string, userName: string, role?: string): ShiftRow => ({
    key, userId, userName, role,
    clockIn: null, clockOut: null, active: false, durationSeconds: 0,
    checks: 0, guests: 0, netSales: 0, cash: 0, otherTenders: {}, otherTotal: 0, collected: 0, deferred: 0, tips: 0,
  });

  for (const entry of entries) {
    const user = entry.user as unknown as PersonRef | undefined;
    const userId = recordIdToString(user?.id ?? entry.user);
    const from = toTime(entry.clock_in);
    if (!userId || from === null) continue;
    const outTime = toTime(entry.clock_out);
    const to = outTime ?? now.getTime();
    const key = recordIdToString(entry.id) || `${userId}-${from}`;
    const row = blank(key, userId, personName(user) || userId, user?.user_role?.name);
    row.clockIn = new Date(from);
    row.clockOut = outTime === null ? null : new Date(outTime);
    row.active = outTime === null;
    row.durationSeconds = Math.max(0, Math.floor((to - from) / 1000));
    rows.set(key, row);
    const list = sessionsByUser.get(userId) ?? [];
    list.push({key, from, to});
    sessionsByUser.set(userId, list);
  }

  for (const order of orders) {
    const collector = ((order.cashier as unknown as PersonRef | undefined) ?? (order.user as unknown as PersonRef | undefined));
    const userId = recordIdToString(collector?.id ?? order.cashier ?? order.user) || "unknown";
    const createdAt = toTime(order.created_at);
    const session = createdAt === null
      ? undefined
      : (sessionsByUser.get(userId) ?? []).find((s) => createdAt >= s.from && createdAt <= s.to);
    let row = session ? rows.get(session.key) : undefined;
    if (!row) {
      const key = `outside:${userId}`;
      row = rows.get(key) ?? blank(key, userId, personName(collector) || userId, collector?.user_role?.name);
      rows.set(key, row);
    }
    const pay = getOrderPaymentTotals(order);
    row.checks += 1;
    row.guests += safeNumber(order.covers ?? 0);
    row.cash += safeNumber(pay.cashAmount);
    for (const [name, amount] of Object.entries(pay.nonCashBreakdown)) {
      row.otherTenders[name] = (row.otherTenders[name] ?? 0) + safeNumber(amount);
      row.otherTotal += safeNumber(amount);
    }
    row.collected += safeNumber(pay.amountCollected);
    row.deferred += safeNumber(pay.deferredAmount);
    row.netSales += orderNetSales(order, safeNumber(pay.amountApplied));
    row.tips += safeNumber(order.tip_amount);
  }

  return [...rows.values()].sort((a, b) =>
    (b.clockIn?.getTime() ?? -1) - (a.clockIn?.getTime() ?? -1) || a.userName.localeCompare(b.userName));
}

export const getShiftReport = async (db: DbClient, range: DateRangeFilter): Promise<ShiftRow[]> => {
  const entryFilter = buildCreatedAtDateConditions(range, "clock_in");
  const orderFilter = buildCreatedAtDateConditions(range);
  const [entries, orders] = await Promise.all([
    db.query(
      `SELECT * FROM ${Tables.time_entries}
       ${entryFilter.conditions.length ? `WHERE ${entryFilter.conditions.join(" AND ")}` : ""}
       ORDER BY clock_in ASC
       FETCH user, user.user_role`,
      entryFilter.params,
    ),
    db.query(
      `SELECT * FROM ${Tables.orders}
       WHERE ${["status = 'Paid'", ...orderFilter.conditions].join(" AND ")}
       FETCH payments, payments.payment_type, cashier, cashier.user_role, user, user.user_role`,
      orderFilter.params,
    ),
  ]);
  return buildShiftRows(unwrapQueryResult<TimeEntry>(entries), unwrapQueryResult<Order>(orders));
};
