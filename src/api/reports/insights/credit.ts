import type {CustomerCreditArRow} from '@/api/reports/sales/customer-credit.ts';
import type {ReportInsight} from '@/components/reports/report-insights.tsx';

type T = (key: string, params?: Record<string, unknown>) => string;

const DAY_MS = 86_400_000;

export const listNames = (names: string[], t: T, max = 3): string => {
  if (names.length <= max) return names.join(', ');
  return t('insights.namesAndMore', {names: names.slice(0, max).join(', '), count: names.length - max});
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Rule-based observations on house-credit receivables.
 * `fmt` formats an amount in the app currency.
 */
export function buildCreditInsights(
  rows: CustomerCreditArRow[],
  t: T,
  fmt: (n: number) => string,
  asOf: Date = new Date(),
): ReportInsight[] {
  const insights: ReportInsight[] = [];
  const debtors = rows.filter((r) => r.due > 0.009);
  const totalDue = debtors.reduce((s, r) => s + r.due, 0);
  const totalCharged = rows.reduce((s, r) => s + r.charged, 0);
  const totalSettled = rows.reduce((s, r) => s + r.settled, 0);

  if (debtors.length === 0) {
    insights.push({id: 'none-due', severity: 'good', text: t('insights.credit.noneDue')});
    return insights;
  }

  const over90 = debtors.filter((r) => (r.aging?.over90 ?? 0) > 0.009);
  if (over90.length) {
    const amount = over90.reduce((s, r) => s + (r.aging?.over90 ?? 0), 0);
    insights.push({
      id: 'over90',
      severity: 'bad',
      text: t('insights.credit.over90', {
        count: over90.length,
        amount: fmt(amount),
        pct: pct(amount, totalDue),
        names: listNames([...over90].sort((a, b) => (b.aging?.over90 ?? 0) - (a.aging?.over90 ?? 0)).map((r) => r.name), t),
      }),
    });
  }

  const d61 = debtors.filter((r) => (r.aging?.d61_90 ?? 0) > 0.009);
  if (d61.length) {
    const amount = d61.reduce((s, r) => s + (r.aging?.d61_90 ?? 0), 0);
    insights.push({
      id: 'd61',
      severity: 'warn',
      text: t('insights.credit.d61_90', {count: d61.length, amount: fmt(amount), names: listNames(d61.map((r) => r.name), t)}),
    });
  }

  const overLimit = debtors.filter((r) => r.creditLimit != null && r.creditLimit > 0 && r.due > r.creditLimit + 0.009);
  if (overLimit.length) {
    insights.push({
      id: 'over-limit',
      severity: 'bad',
      text: t('insights.credit.overLimit', {
        count: overLimit.length,
        names: listNames(overLimit.map((r) => `${r.name} (${fmt(r.due)} / ${fmt(r.creditLimit ?? 0)})`), t, 3),
      }),
    });
  }

  const revoked = debtors.filter((r) => r.creditAllowed === false);
  if (revoked.length) {
    insights.push({
      id: 'revoked',
      severity: 'warn',
      text: t('insights.credit.revokedOwes', {
        count: revoked.length,
        amount: fmt(revoked.reduce((s, r) => s + r.due, 0)),
        names: listNames(revoked.map((r) => r.name), t),
      }),
    });
  }

  const silent = debtors.filter((r) => {
    const last = r.lastSettlementAt ?? null;
    const lastCharge = r.lastChargeAt ?? null;
    const noPayFor = last ? (asOf.getTime() - last.getTime()) / DAY_MS : Infinity;
    const chargeAge = lastCharge ? (asOf.getTime() - lastCharge.getTime()) / DAY_MS : Infinity;
    return noPayFor > 60 && chargeAge > 30;
  });
  if (silent.length) {
    insights.push({
      id: 'silent',
      severity: 'warn',
      text: t('insights.credit.noPayment60', {
        count: silent.length,
        amount: fmt(silent.reduce((s, r) => s + r.due, 0)),
        names: listNames([...silent].sort((a, b) => b.due - a.due).map((r) => r.name), t),
      }),
    });
  }

  if (debtors.length >= 4) {
    const top = [...debtors].sort((a, b) => b.due - a.due).slice(0, 3);
    const share = pct(top.reduce((s, r) => s + r.due, 0), totalDue);
    if (share >= 50) {
      insights.push({
        id: 'concentration',
        severity: 'info',
        text: t('insights.credit.concentration', {pct: share, names: top.map((r) => r.name).join(', ')}),
      });
    }
  }

  if (totalCharged > 0) {
    const rate = pct(totalSettled, totalCharged);
    insights.push({
      id: 'collection-rate',
      severity: rate >= 80 ? 'good' : rate >= 50 ? 'info' : 'warn',
      text: t('insights.credit.collectionRate', {pct: rate, settled: fmt(totalSettled), charged: fmt(totalCharged)}),
    });
  }

  return insights;
}
