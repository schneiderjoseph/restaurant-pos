import type {ReportInsight} from '@/components/reports/report-insights.tsx';
import {listNames} from '@/api/reports/insights/credit.ts';

type T = (key: string, params?: Record<string, unknown>) => string;

export type ProductFigure = { name: string; category: string; quantity: number; amount: number; discount: number };

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** How many of the best sellers it takes to reach `target` share of sales. */
export function paretoCount(items: ProductFigure[], target = 0.8): number {
  const total = items.reduce((s, i) => s + Math.max(0, i.amount), 0);
  if (total <= 0) return 0;
  let running = 0;
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  for (let i = 0; i < sorted.length; i++) {
    running += Math.max(0, sorted[i].amount);
    if (running / total >= target) return i + 1;
  }
  return sorted.length;
}

export const LOW_SELLER_MAX_QTY = 2;
export const ITEM_DISCOUNT_WARN_PCT = 15;

export function buildProductMixInsights(items: ProductFigure[], t: T, fmt: (n: number) => string): ReportInsight[] {
  const out: ReportInsight[] = [];
  const sold = items.filter((i) => i.quantity > 0);
  const total = sold.reduce((s, i) => s + i.amount, 0);
  if (sold.length === 0) {
    out.push({id: 'none', severity: 'info', text: t('insights.products.none')});
    return out;
  }

  const byAmount = [...sold].sort((a, b) => b.amount - a.amount);
  const top3 = byAmount.slice(0, 3);
  out.push({
    id: 'top3',
    severity: 'info',
    text: t('insights.products.top3', {
      names: top3.map((i) => `${i.name} (${fmt(i.amount)})`).join(', '),
      pct: share(top3.reduce((s, i) => s + i.amount, 0), total),
    }),
  });

  if (sold.length >= 5) {
    const n = paretoCount(sold);
    out.push({id: 'pareto', severity: 'info', text: t('insights.products.pareto', {count: n, total: sold.length, pct: share(n, sold.length)})});
  }

  const categories = new Map<string, number>();
  sold.forEach((i) => categories.set(i.category, (categories.get(i.category) ?? 0) + i.amount));
  if (categories.size > 1) {
    const [cat, amount] = [...categories.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({id: 'top-category', severity: 'info', text: t('insights.products.topCategory', {category: cat, pct: share(amount, total)})});
  }

  const low = sold.filter((i) => i.quantity <= LOW_SELLER_MAX_QTY);
  if (low.length > 0 && sold.length >= 5) {
    out.push({
      id: 'low-sellers',
      severity: 'warn',
      text: t('insights.products.lowSellers', {count: low.length, max: LOW_SELLER_MAX_QTY, names: listNames(low.map((i) => i.name), t, 5)}),
    });
  }

  const discounted = sold.filter((i) => i.amount > 0 && share(i.discount, i.amount + i.discount) >= ITEM_DISCOUNT_WARN_PCT);
  if (discounted.length > 0) {
    out.push({
      id: 'discounted',
      severity: 'warn',
      text: t('insights.products.heavyDiscounts', {
        count: discounted.length,
        limit: ITEM_DISCOUNT_WARN_PCT,
        names: listNames(discounted.sort((a, b) => b.discount - a.discount).map((i) => `${i.name} (${fmt(i.discount)})`), t),
      }),
    });
  }

  return out;
}
