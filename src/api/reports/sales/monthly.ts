import {DateTime} from 'luxon';
import {Tables} from '@/api/db/tables.ts';
import type {Order} from '@/api/model/order.ts';
import {unwrapQueryResult} from '@/api/reports/shared/query.ts';
import type {DbClient} from '@/api/reports/shared/types.ts';
import {getAppTimezone, toJsDate} from '@/lib/datetime.ts';
import {fiscalYearLabel, fiscalYearStart, loadFiscalStartMonth} from '@/lib/fiscal-year.ts';
import {getOrderPaymentTotals} from '@/lib/order.ts';
import {getOrderTaxAmount} from '@/lib/tax-calculator.ts';
import {safeNumber} from '@/lib/utils.ts';

/** One calendar month of paid orders. */
export type MonthFigures = {
  /** yyyy-MM in the app timezone */
  month: string;
  netSales: number;
  checks: number;
  guests: number;
  tax: number;
  tips: number;
  /** Room + house credit included in net sales. */
  deferred: number;
  /** Days of the month that had at least one paid order. */
  openDays: number;
};

export type FiscalYearFigures = {
  /** "2025-2026" */
  label: string;
  /** yyyy-MM-dd of the first day */
  start: string;
  netSales: number;
  checks: number;
  guests: number;
  /** Months with sales, for partial years. */
  months: number;
};

const blankMonth = (month: string): MonthFigures => ({month, netSales: 0, checks: 0, guests: 0, tax: 0, tips: 0, deferred: 0, openDays: 0});

/** Net sales of one order: everything applied (till + room + credit) minus service, tax and tips. */
export const orderNetSales = (order: Order): number => {
  const pay = getOrderPaymentTotals(order);
  return safeNumber(pay.amountApplied - safeNumber(order.service_charge_amount) - getOrderTaxAmount(order) - safeNumber(order.tip_amount));
};

/** Paid orders grouped by calendar month (app timezone). */
export function aggregateByMonth(orders: Order[], zone = getAppTimezone()): Map<string, MonthFigures> {
  const months = new Map<string, MonthFigures>();
  const days = new Map<string, Set<string>>();
  for (const order of orders) {
    let at: DateTime;
    try {
      at = DateTime.fromJSDate(toJsDate(order.created_at as Parameters<typeof toJsDate>[0]), {zone});
    } catch {
      continue;
    }
    if (!at.isValid) continue;
    const key = at.toFormat('yyyy-LL');
    const m = months.get(key) ?? blankMonth(key);
    m.netSales += orderNetSales(order);
    m.checks += 1;
    m.guests += safeNumber(order.covers ?? 0);
    m.tax += getOrderTaxAmount(order);
    m.tips += safeNumber(order.tip_amount);
    m.deferred += getOrderPaymentTotals(order).deferredAmount;
    months.set(key, m);
    const set = days.get(key) ?? new Set<string>();
    set.add(at.toISODate() ?? '');
    days.set(key, set);
  }
  for (const [key, m] of months) {
    m.openDays = days.get(key)?.size ?? 0;
    m.netSales = safeNumber(m.netSales);
    m.tax = safeNumber(m.tax);
    m.tips = safeNumber(m.tips);
    m.deferred = safeNumber(m.deferred);
  }
  return months;
}

/** The 12 months of the fiscal year starting at `start`, filled with zeros where nothing sold. */
export const fiscalYearMonths = (months: Map<string, MonthFigures>, start: DateTime): MonthFigures[] =>
  Array.from({length: 12}, (_, i) => {
    const key = start.plus({months: i}).toFormat('yyyy-LL');
    return months.get(key) ?? blankMonth(key);
  });

/** Totals per fiscal year, oldest first. */
export function aggregateByFiscalYear(months: Map<string, MonthFigures>, startMonth: number, zone = getAppTimezone()): FiscalYearFigures[] {
  const years = new Map<string, FiscalYearFigures>();
  for (const m of months.values()) {
    const start = fiscalYearStart(DateTime.fromFormat(m.month, 'yyyy-LL', {zone}), startMonth);
    const key = start.toISODate() ?? m.month;
    const y = years.get(key) ?? {label: fiscalYearLabel(start), start: key, netSales: 0, checks: 0, guests: 0, months: 0};
    y.netSales += m.netSales;
    y.checks += m.checks;
    y.guests += m.guests;
    if (m.checks > 0) y.months += 1;
    years.set(key, y);
  }
  return [...years.values()].map((y) => ({...y, netSales: safeNumber(y.netSales)})).sort((a, b) => a.start.localeCompare(b.start));
}

export type MonthlySalesData = {
  startMonth: number;
  months: Map<string, MonthFigures>;
  years: FiscalYearFigures[];
};

/** Every paid order, grouped by month and fiscal year. */
export const getMonthlySales = async (db: DbClient): Promise<MonthlySalesData> => {
  const [startMonth, result] = await Promise.all([
    loadFiscalStartMonth(db),
    db.query(
      `SELECT created_at, covers, tax_amount, service_charge_amount, tip_amount, tax, payments, order_taxes, items
       FROM ${Tables.orders}
       WHERE status = 'Paid' AND deleted_at = none
       FETCH payments, payments.payment_type, items, items.taxes, items.tax_mode, tax, order_taxes, order_taxes.tax`,
    ),
  ]);
  const months = aggregateByMonth(unwrapQueryResult<Order>(result));
  return {startMonth, months, years: aggregateByFiscalYear(months, startMonth)};
};
