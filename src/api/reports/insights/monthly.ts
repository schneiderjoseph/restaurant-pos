import type {ReportInsight} from '@/components/reports/report-insights.tsx';
import type {MonthFigures} from '@/api/reports/sales/monthly.ts';
import {pctChange} from '@/api/reports/insights/sales.ts';

type T = (key: string, params?: Record<string, unknown>) => string;

/** A completed month this far below the same month last year is flagged. */
export const MONTH_DROP_PCT = 10;

export type MonthlyInsightInput = {
  current: MonthFigures[];
  previous: MonthFigures[];
  /** Index (0–11) of the running month in `current`; 12 when the fiscal year is over. */
  runningIndex: number;
  /** Share (0–1) of the running month already elapsed. */
  runningProgress: number;
  monthName: (m: MonthFigures) => string;
};

const sum = (ms: MonthFigures[], f: (m: MonthFigures) => number) => ms.reduce((s, m) => s + f(m), 0);

/** Rule-based observations on monthly sales against the previous fiscal year. */
export function buildMonthlyInsights(input: MonthlyInsightInput, t: T, fmt: (n: number) => string): ReportInsight[] {
  const out: ReportInsight[] = [];
  const {current, previous, runningIndex, runningProgress, monthName} = input;
  const completed = current.slice(0, Math.min(runningIndex, 12));
  const completedPrev = previous.slice(0, completed.length);
  const hasHistory = sum(previous, (m) => m.checks) > 0;

  if (sum(current, (m) => m.checks) === 0) {
    out.push({id: 'none', severity: 'info', text: t('insights.monthly.none')});
    return out;
  }
  if (!hasHistory) {
    out.push({id: 'no-history', severity: 'info', text: t('insights.monthly.noHistory')});
  }

  if (completed.length > 0 && hasHistory) {
    const cur = sum(completed, (m) => m.netSales);
    const prev = sum(completedPrev, (m) => m.netSales);
    const change = pctChange(cur, prev);
    if (change !== null) {
      out.push({
        id: 'ytd',
        severity: change >= 0 ? 'good' : change <= -MONTH_DROP_PCT ? 'bad' : 'warn',
        text: t('insights.monthly.ytd', {
          from: monthName(completed[0]), to: monthName(completed[completed.length - 1]),
          amount: fmt(cur), previous: fmt(prev), pct: `${change > 0 ? '+' : ''}${Math.round(change)}`,
        }),
      });
    }
    const curChecks = sum(completed, (m) => m.checks);
    const prevChecks = sum(completedPrev, (m) => m.checks);
    const avgChange = curChecks > 0 && prevChecks > 0 ? pctChange(cur / curChecks, prev / prevChecks) : null;
    if (avgChange !== null && Math.abs(avgChange) >= 10) {
      out.push({
        id: 'avg-check',
        severity: avgChange > 0 ? 'good' : 'warn',
        text: t('insights.monthly.avgCheck', {avg: fmt(cur / curChecks), previous: fmt(prev / prevChecks), pct: `${avgChange > 0 ? '+' : ''}${Math.round(avgChange)}`}),
      });
    }
  }

  const sold = completed.filter((m) => m.checks > 0);
  if (sold.length >= 2) {
    const best = [...sold].sort((a, b) => b.netSales - a.netSales)[0];
    const worst = [...sold].sort((a, b) => a.netSales - b.netSales)[0];
    out.push({id: 'best-worst', severity: 'info', text: t('insights.monthly.bestWorst', {best: monthName(best), bestAmount: fmt(best.netSales), worst: monthName(worst), worstAmount: fmt(worst.netSales)})});
  }

  const drops = completed
    .map((m, i) => ({m, change: pctChange(m.netSales, completedPrev[i]?.netSales ?? 0)}))
    .filter((x) => x.change !== null && (x.change as number) <= -MONTH_DROP_PCT);
  if (drops.length) {
    out.push({
      id: 'drops',
      severity: 'warn',
      text: t('insights.monthly.drops', {count: drops.length, pct: MONTH_DROP_PCT, months: drops.map((x) => `${monthName(x.m)} (${Math.round(x.change as number)} %)`).join(', ')}),
    });
  }

  const running = runningIndex < 12 ? current[runningIndex] : undefined;
  if (running && running.checks > 0 && runningProgress > 0.05 && runningProgress < 1) {
    const projected = running.netSales / runningProgress;
    const prev = previous[runningIndex]?.netSales ?? 0;
    const change = pctChange(projected, prev);
    out.push({
      id: 'pace',
      severity: change === null ? 'info' : change >= 0 ? 'good' : change <= -MONTH_DROP_PCT ? 'warn' : 'info',
      text: change === null
        ? t('insights.monthly.paceNoHistory', {month: monthName(running), amount: fmt(running.netSales), projected: fmt(projected)})
        : t('insights.monthly.pace', {month: monthName(running), amount: fmt(running.netSales), projected: fmt(projected), previous: fmt(prev), pct: `${change > 0 ? '+' : ''}${Math.round(change)}`}),
    });
  }
  return out;
}
