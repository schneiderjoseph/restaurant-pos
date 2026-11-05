import {describe, expect, it} from 'vitest';
import {buildProductMixInsights, paretoCount} from '@/api/reports/insights/products.ts';
import {buildServerInsights} from '@/api/reports/insights/servers.ts';
import {buildVoidInsights} from '@/api/reports/insights/voids.ts';

const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? ' ' + JSON.stringify(params) : ''}`;
const fmt = (n: number) => n.toFixed(0);

describe('product mix rules', () => {
  const items = [
    {name: 'Lambi', category: 'Plats', quantity: 40, amount: 8000, discount: 0},
    {name: 'Griot', category: 'Plats', quantity: 30, amount: 6000, discount: 0},
    {name: 'Jus', category: 'Boissons', quantity: 50, amount: 2500, discount: 600},
    {name: 'Salade', category: 'Entrées', quantity: 2, amount: 300, discount: 0},
    {name: 'Soupe', category: 'Entrées', quantity: 1, amount: 200, discount: 0},
  ];

  it('counts the items making 80% of sales', () => {
    expect(paretoCount(items)).toBe(2); // 8000 + 6000 = 82 % of 17000
  });

  it('flags low sellers and heavily discounted items', () => {
    const ids = buildProductMixInsights(items, t, fmt).map((i) => i.id);
    expect(ids).toEqual(['top3', 'pareto', 'top-category', 'low-sellers', 'discounted']);
  });
});

describe('server rules', () => {
  it('names the top seller, the averages and heavy discounters', () => {
    const ids = buildServerInsights([
      {userId: 'a', name: 'Ana', netSales: 10000, checks: 20, guests: 40, reductions: 100},
      {userId: 'b', name: 'Bob', netSales: 3000, checks: 15, guests: 20, reductions: 900},
    ], t, fmt).map((i) => i.id);
    expect(ids).toEqual(['top-seller', 'best-average', 'low-average', 'heavy-reductions']);
  });

  it('stays quiet with a single server', () => {
    expect(buildServerInsights([{userId: 'a', name: 'Ana', netSales: 10, checks: 1, guests: 1, reductions: 0}], t, fmt)).toEqual([]);
  });
});

describe('void rules', () => {
  it('flags a cashier holding most of the voided amount and missing comments', () => {
    const out = buildVoidInsights({
      count: 4,
      amount: 1000,
      byReason: [{name: 'Erreur', count: 4, quantity: 4, amount: 1000}],
      byManager: [{name: 'Chef', count: 4, quantity: 4, amount: 1000}],
      byCashier: [{name: 'Zoé', count: 3, quantity: 3, amount: 800}, {name: 'Luc', count: 1, quantity: 1, amount: 200}],
      byItem: [{name: 'Lambi', count: 3, quantity: 3, amount: 900}, {name: 'Jus', count: 1, quantity: 1, amount: 100}],
      withoutComment: 2,
    }, t, fmt);
    expect(out.map((i) => i.id)).toEqual(['top-reason', 'cashier-concentration', 'top-item', 'no-comment']);
    expect(out.find((i) => i.id === 'no-comment')?.severity).toBe('warn');
  });
});
