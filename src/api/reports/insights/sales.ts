import type {ReportInsight} from '@/components/reports/report-insights.tsx';

type T = (key: string, params?: Record<string, unknown>) => string;

/** Subset of the sales summary aggregate the rules need. */
export type SalesSummaryFigures = {
  totalNetSales: number;
  totalDiscounts: number;
  totalCoupons: number;
  totalVoids: number;
  paymentSummary: { amountCollected: number; deferredCharges: number; roomCharges: number; creditCharges: number };
  dayPartTotals: Record<string, { checks: number; guests: number; sales: number }>;
  orderTypeBreakdown: Array<{ label: string; value: number }>;
};

export const sumChecks = (s: SalesSummaryFigures) =>
  Object.values(s.dayPartTotals).reduce((acc, p) => acc + p.checks, 0);
export const sumGuests = (s: SalesSummaryFigures) =>
  Object.values(s.dayPartTotals).reduce((acc, p) => acc + p.guests, 0);

/** Percentage change, or null when the base is zero. */
export const pctChange = (current: number, previous: number): number | null =>
  previous > 0.009 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

export const DISCOUNT_WARN_PCT = 5;
export const VOID_WARN_PCT = 3;
export const DEFERRED_WARN_PCT = 20;

export function buildSalesSummaryInsights(
  current: SalesSummaryFigures,
  previous: SalesSummaryFigures | null,
  t: T,
  fmt: (n: number) => string,
): ReportInsight[] {
  const out: ReportInsight[] = [];
  const net = current.totalNetSales;
  const checks = sumChecks(current);

  if (checks === 0 && net <= 0.009) {
    out.push({id: 'no-sales', severity: 'info', text: t('insights.sales.noSales')});
    return out;
  }

  if (previous) {
    const change = pctChange(net, previous.totalNetSales);
    if (change !== null) {
      out.push({
        id: 'trend',
        severity: change >= 5 ? 'good' : change <= -10 ? 'bad' : change < 0 ? 'warn' : 'info',
        text: t(change >= 0 ? 'insights.sales.up' : 'insights.sales.down', {
          pct: Math.abs(change),
          current: fmt(net),
          previous: fmt(previous.totalNetSales),
        }),
      });
      const prevChecks = sumChecks(previous);
      const avg = checks > 0 ? net / checks : 0;
      const prevAvg = prevChecks > 0 ? previous.totalNetSales / prevChecks : 0;
      const checkChange = pctChange(checks, prevChecks);
      const avgChange = pctChange(avg, prevAvg);
      if (checkChange !== null && avgChange !== null && Math.abs(change) >= 5) {
        // Explain the move: more/fewer customers, or bigger/smaller tickets.
        const driver = Math.abs(checkChange) >= Math.abs(avgChange) ? 'checks' : 'average';
        out.push({
          id: 'driver',
          severity: 'info',
          text: t(driver === 'checks' ? 'insights.sales.driverChecks' : 'insights.sales.driverAverage', {
            checks,
            prevChecks,
            checkPct: checkChange,
            avg: fmt(avg),
            prevAvg: fmt(prevAvg),
            avgPct: avgChange,
          }),
        });
      }
    }
  }

  const parts = Object.entries(current.dayPartTotals).filter(([, p]) => p.sales > 0);
  if (parts.length > 1) {
    const [bestName, best] = parts.sort((a, b) => b[1].sales - a[1].sales)[0];
    out.push({
      id: 'best-daypart',
      severity: 'info',
      text: t('insights.sales.bestDayPart', {part: bestName, pct: share(best.sales, net), amount: fmt(best.sales)}),
    });
  }

  const types = current.orderTypeBreakdown.filter((o) => o.value > 0);
  if (types.length > 1) {
    const top = [...types].sort((a, b) => b.value - a.value)[0];
    out.push({
      id: 'top-type',
      severity: 'info',
      text: t('insights.sales.topOrderType', {type: top.label, pct: share(top.value, net)}),
    });
  }

  const discounts = current.totalDiscounts; // includes coupons
  const discountPct = share(discounts, net + discounts);
  if (discountPct >= DISCOUNT_WARN_PCT) {
    out.push({
      id: 'discounts',
      severity: 'warn',
      text: t('insights.sales.highDiscounts', {pct: discountPct, amount: fmt(discounts), limit: DISCOUNT_WARN_PCT}),
    });
  }

  const voidPct = share(current.totalVoids, net + current.totalVoids);
  if (voidPct >= VOID_WARN_PCT) {
    out.push({
      id: 'voids',
      severity: 'warn',
      text: t('insights.sales.highVoids', {pct: voidPct, amount: fmt(current.totalVoids), limit: VOID_WARN_PCT}),
    });
  }

  const deferred = current.paymentSummary.deferredCharges;
  const deferredPct = share(deferred, net);
  if (deferred > 0.009) {
    out.push({
      id: 'deferred',
      severity: deferredPct >= DEFERRED_WARN_PCT ? 'warn' : 'info',
      text: t('insights.sales.deferred', {
        pct: deferredPct,
        amount: fmt(deferred),
        room: fmt(current.paymentSummary.roomCharges),
        credit: fmt(current.paymentSummary.creditCharges),
      }),
    });
  }

  return out;
}
