import type {ReportInsight} from '@/components/reports/report-insights.tsx';

type T = (key: string, params?: Record<string, unknown>) => string;

export type ServerFigure = {
  userId: string;
  name: string;
  netSales: number;
  checks: number;
  guests: number;
  reductions: number; // discounts + coupons
};

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const avg = (s: ServerFigure) => (s.checks > 0 ? s.netSales / s.checks : 0);
const reductionRate = (s: ServerFigure) => (s.netSales + s.reductions > 0 ? s.reductions / (s.netSales + s.reductions) : 0);

/** Rule-based comparisons between servers. */
export function buildServerInsights(servers: ServerFigure[], t: T, fmt: (n: number) => string): ReportInsight[] {
  const out: ReportInsight[] = [];
  const active = servers.filter((s) => s.netSales > 0 || s.checks > 0);
  if (active.length < 2) return out;

  const total = active.reduce((sum, s) => sum + s.netSales, 0);
  const totalChecks = active.reduce((sum, s) => sum + s.checks, 0);
  const teamAvg = totalChecks > 0 ? total / totalChecks : 0;
  const totalReductions = active.reduce((sum, s) => sum + s.reductions, 0);
  const teamReductionRate = total + totalReductions > 0 ? totalReductions / (total + totalReductions) : 0;

  const top = [...active].sort((a, b) => b.netSales - a.netSales)[0];
  out.push({
    id: 'top-seller',
    severity: 'good',
    text: t('insights.servers.topSeller', {name: top.name, amount: fmt(top.netSales), pct: share(top.netSales, total)}),
  });

  const withChecks = active.filter((s) => s.checks >= 3);
  if (withChecks.length >= 2 && teamAvg > 0) {
    const best = [...withChecks].sort((a, b) => avg(b) - avg(a))[0];
    out.push({
      id: 'best-average',
      severity: 'info',
      text: t('insights.servers.bestAverage', {name: best.name, avg: fmt(avg(best)), team: fmt(teamAvg)}),
    });
    const low = withChecks.filter((s) => avg(s) < teamAvg * 0.75);
    if (low.length) {
      out.push({
        id: 'low-average',
        severity: 'info',
        text: t('insights.servers.lowAverage', {
          names: low.map((s) => `${s.name} (${fmt(avg(s))})`).join(', '),
          team: fmt(teamAvg),
        }),
      });
    }
  }

  if (teamReductionRate > 0) {
    const heavy = active.filter((s) => s.reductions > 0 && reductionRate(s) >= Math.max(teamReductionRate * 2, 0.05));
    if (heavy.length) {
      out.push({
        id: 'heavy-reductions',
        severity: 'warn',
        text: t('insights.servers.heavyReductions', {
          names: heavy.map((s) => `${s.name} (${Math.round(reductionRate(s) * 100)} %)`).join(', '),
          team: Math.round(teamReductionRate * 100),
        }),
      });
    }
  }

  return out;
}
