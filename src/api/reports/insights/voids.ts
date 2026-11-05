import type {ReportInsight} from '@/components/reports/report-insights.tsx';

type T = (key: string, params?: Record<string, unknown>) => string;

export type VoidGroupRow = { name: string; count: number; quantity: number; amount: number };

export type VoidFigures = {
  count: number;
  amount: number;
  byReason: VoidGroupRow[];
  byManager: VoidGroupRow[];
  byCashier: VoidGroupRow[];
  byItem: VoidGroupRow[];
  withoutComment: number;
};

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const top = (rows: VoidGroupRow[]) => [...rows].sort((a, b) => b.amount - a.amount || b.count - a.count)[0];

/** Rule-based observations on voids (who, why, what). */
export function buildVoidInsights(f: VoidFigures, t: T, fmt: (n: number) => string): ReportInsight[] {
  const out: ReportInsight[] = [];
  if (f.count === 0) {
    out.push({id: 'none', severity: 'good', text: t('insights.voids.none')});
    return out;
  }

  const reason = top(f.byReason);
  if (reason) {
    out.push({
      id: 'top-reason',
      severity: 'info',
      text: t('insights.voids.topReason', {reason: reason.name, count: reason.count, pct: share(reason.amount, f.amount), amount: fmt(reason.amount)}),
    });
  }

  if (f.byCashier.length >= 2) {
    const c = top(f.byCashier);
    const pct = share(c.amount, f.amount);
    if (pct >= 40) {
      out.push({
        id: 'cashier-concentration',
        severity: 'warn',
        text: t('insights.voids.cashierConcentration', {name: c.name, pct, count: c.count, amount: fmt(c.amount)}),
      });
    }
  }

  if (f.byManager.length >= 2) {
    const m = top(f.byManager);
    const pct = share(m.count, f.count);
    if (pct >= 60) {
      out.push({id: 'manager-concentration', severity: 'info', text: t('insights.voids.managerConcentration', {name: m.name, pct})});
    }
  }

  const item = top(f.byItem);
  if (item && f.byItem.length >= 2) {
    out.push({
      id: 'top-item',
      severity: 'info',
      text: t('insights.voids.topItem', {item: item.name, quantity: item.quantity, amount: fmt(item.amount)}),
    });
  }

  if (f.withoutComment > 0) {
    out.push({
      id: 'no-comment',
      severity: share(f.withoutComment, f.count) >= 30 ? 'warn' : 'info',
      text: t('insights.voids.withoutComment', {count: f.withoutComment, pct: share(f.withoutComment, f.count)}),
    });
  }

  return out;
}
