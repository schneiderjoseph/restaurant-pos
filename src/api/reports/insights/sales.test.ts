import {describe, expect, it} from 'vitest';
import {buildSalesSummaryInsights, pctChange, type SalesSummaryFigures} from '@/api/reports/insights/sales.ts';

const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? ' ' + JSON.stringify(params) : ''}`;
const fmt = (n: number) => n.toFixed(0);

const figures = (over: Partial<SalesSummaryFigures> = {}): SalesSummaryFigures => ({
  totalNetSales: 10000,
  totalDiscounts: 100,
  totalCoupons: 0,
  totalVoids: 50,
  paymentSummary: {amountCollected: 9000, deferredCharges: 1000, roomCharges: 600, creditCharges: 400},
  dayPartTotals: {
    Breakfast: {checks: 20, guests: 25, sales: 2000},
    Lunch: {checks: 60, guests: 80, sales: 6000},
    Dinner: {checks: 20, guests: 30, sales: 2000},
  },
  orderTypeBreakdown: [{label: 'Dine-in', value: 7000}, {label: 'Takeaway', value: 3000}],
  ...over,
});

describe('pctChange', () => {
  it('returns null on a zero base', () => {
    expect(pctChange(10, 0)).toBeNull();
    expect(pctChange(110, 100)).toBe(10);
  });
});

describe('buildSalesSummaryInsights', () => {
  it('reports the trend, best day part, top order type and uncollected sales', () => {
    const prev = figures({totalNetSales: 8000, dayPartTotals: {
      Breakfast: {checks: 16, guests: 20, sales: 1600},
      Lunch: {checks: 48, guests: 60, sales: 4800},
      Dinner: {checks: 16, guests: 20, sales: 1600},
    }});
    const ids = buildSalesSummaryInsights(figures(), prev, t, fmt).map((i) => i.id);
    expect(ids).toEqual(['trend', 'driver', 'best-daypart', 'top-type', 'deferred']);
  });

  it('warns on heavy discounts and voids', () => {
    const out = buildSalesSummaryInsights(figures({totalDiscounts: 1000, totalVoids: 800}), null, t, fmt);
    expect(out.find((i) => i.id === 'discounts')?.severity).toBe('warn');
    expect(out.find((i) => i.id === 'voids')?.severity).toBe('warn');
  });

  it('says so when there are no sales', () => {
    const empty = figures({totalNetSales: 0, dayPartTotals: {Lunch: {checks: 0, guests: 0, sales: 0}}});
    expect(buildSalesSummaryInsights(empty, null, t, fmt).map((i) => i.id)).toEqual(['no-sales']);
  });
});
