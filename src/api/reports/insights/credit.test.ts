import {describe, expect, it} from 'vitest';
import {computeCreditAging, type CustomerCreditArRow} from '@/api/reports/sales/customer-credit.ts';
import {buildCreditInsights} from '@/api/reports/insights/credit.ts';

const asOf = new Date('2026-11-05T12:00:00Z');
const daysAgo = (n: number) => new Date(asOf.getTime() - n * 86_400_000);
const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? ' ' + JSON.stringify(params) : ''}`;
const fmt = (n: number) => n.toFixed(2);

describe('computeCreditAging', () => {
  it('applies settlements to the oldest charges first', () => {
    const aging = computeCreditAging(
      [
        {at: daysAgo(100), amount: 100},
        {at: daysAgo(45), amount: 50},
        {at: daysAgo(5), amount: 30},
      ],
      120,
      asOf,
    );
    // 100 (oldest) fully paid, 20 of the 50 paid → 30 left in 31–60, 30 current.
    expect(aging).toEqual({current: 30, d31_60: 30, d61_90: 0, over90: 0, oldestDueDays: 45});
  });

  it('puts unpaid old charges in the 90+ bucket', () => {
    const aging = computeCreditAging([{at: daysAgo(120), amount: 80}, {at: daysAgo(70), amount: 20}], 0, asOf);
    expect(aging.over90).toBe(80);
    expect(aging.d61_90).toBe(20);
    expect(aging.oldestDueDays).toBe(120);
  });

  it('reports nothing due once fully settled', () => {
    expect(computeCreditAging([{at: daysAgo(10), amount: 50}], 50, asOf)).toEqual({
      current: 0, d31_60: 0, d61_90: 0, over90: 0, oldestDueDays: null,
    });
  });
});

describe('buildCreditInsights', () => {
  const row = (over: Partial<CustomerCreditArRow>): CustomerCreditArRow => ({
    customerId: over.name ?? 'c',
    name: 'C',
    charged: 0,
    settled: 0,
    due: 0,
    ...over,
  });

  it('says all is clear when nobody owes', () => {
    const out = buildCreditInsights([row({charged: 10, settled: 10})], t, fmt, asOf);
    expect(out.map((i) => i.id)).toEqual(['none-due']);
  });

  it('flags 90+ days, over-limit, revoked and silent debtors', () => {
    const rows = [
      row({name: 'Old', charged: 100, due: 100, aging: {current: 0, d31_60: 0, d61_90: 0, over90: 100, oldestDueDays: 120}, lastChargeAt: daysAgo(120)}),
      row({name: 'Limit', charged: 500, due: 500, creditLimit: 300, aging: {current: 500, d31_60: 0, d61_90: 0, over90: 0, oldestDueDays: 3}, lastChargeAt: daysAgo(3)}),
      row({name: 'Revoked', charged: 50, settled: 0, due: 50, creditAllowed: false, aging: {current: 50, d31_60: 0, d61_90: 0, over90: 0, oldestDueDays: 2}, lastChargeAt: daysAgo(2)}),
    ];
    const ids = buildCreditInsights(rows, t, fmt, asOf).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['over90', 'over-limit', 'revoked', 'silent', 'collection-rate']));
    expect(ids).not.toContain('concentration');
  });
});
