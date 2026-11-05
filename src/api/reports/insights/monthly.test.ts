import {describe, expect, it} from 'vitest';
import {DateTime} from 'luxon';
import type {Order} from '@/api/model/order.ts';
import {aggregateByFiscalYear, aggregateByMonth, fiscalYearMonths, type MonthFigures} from '@/api/reports/sales/monthly.ts';
import {buildMonthlyInsights} from '@/api/reports/insights/monthly.ts';

const zone = 'America/Port-au-Prince';
const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? ' ' + JSON.stringify(params) : ''}`;
const fmt = (n: number) => n.toFixed(0);

const order = (createdAt: string, amount: number, extra: Record<string, unknown> = {}): Order => ({
  created_at: createdAt,
  status: 'Paid',
  tax_amount: 0,
  payments: [{amount, payable: amount, payment_type: {type: 'Cash', name: 'Cash'}}],
  ...extra,
}) as unknown as Order;

describe('monthly sales', () => {
  it('groups by month in the app timezone and rolls months up to fiscal years', () => {
    const months = aggregateByMonth([
      // 30 Sept 23:30 in Haiti is 1 Oct UTC: still September, last month of FY 2025-2026.
      order('2026-10-01T03:30:00Z', 100),
      order('2026-10-02T15:00:00Z', 200, {tax_amount: 20, payments: [{amount: 200, payable: 200, payment_type: {type: 'Room', name: 'ROOM'}}]}),
      order('2025-10-10T15:00:00Z', 50),
    ], zone);
    expect(months.get('2026-09')).toMatchObject({netSales: 100, checks: 1, openDays: 1});
    expect(months.get('2026-10')).toMatchObject({netSales: 180, tax: 20, deferred: 200});
    const years = aggregateByFiscalYear(months, 10, zone);
    expect(years.map((y) => [y.label, y.netSales, y.months])).toEqual([['2025-2026', 150, 2], ['2026-2027', 180, 1]]);
    const fy = fiscalYearMonths(months, DateTime.fromISO('2026-10-01', {zone}));
    expect(fy).toHaveLength(12);
    expect(fy[0].month).toBe('2026-10');
    expect(fy[11].month).toBe('2027-09');
  });
});

describe('monthly rules', () => {
  const m = (month: string, netSales: number, checks = 10): MonthFigures => ({month, netSales, checks, guests: 0, tax: 0, tips: 0, deferred: 0, openDays: 1});
  const blank = (i: number) => m(`x-${i}`, 0, 0);

  it('compares the completed months, flags drops and projects the running month', () => {
    const current = [m('oct', 900), m('nov', 1200), m('dec', 300), ...Array.from({length: 9}, (_, i) => blank(i))];
    const previous = [m('oct', 1000), m('nov', 1000), m('dec', 1000), ...Array.from({length: 9}, (_, i) => blank(i))];
    const ids = buildMonthlyInsights({current, previous, runningIndex: 2, runningProgress: 0.5, monthName: (x) => x.month}, t, fmt).map((i) => i.id);
    expect(ids).toEqual(['ytd', 'best-worst', 'drops', 'pace']);
  });

  it('says when there is no previous year to compare with', () => {
    const current = [m('oct', 900), ...Array.from({length: 11}, (_, i) => blank(i))];
    const previous = Array.from({length: 12}, (_, i) => blank(i));
    const ids = buildMonthlyInsights({current, previous, runningIndex: 0, runningProgress: 0.3, monthName: (x) => x.month}, t, fmt).map((i) => i.id);
    expect(ids).toEqual(['no-history', 'pace']);
  });
});
