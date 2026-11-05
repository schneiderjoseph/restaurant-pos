import {type ReactNode, useEffect, useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {parseDateRangeFromParams, previousPeriod} from "@/api/reports/shared/filters.ts";
import {
  aggregateSalesByOutlet,
  aggregateSalesSummary,
  fetchOrderVoids,
  fetchPaidOrders,
  SALES_SUMMARY_FETCHES,
  UNCLASSIFIED_OUTLET_ID,
} from "@/api/reports/sales";
import {cn, formatNumber, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {DAY_PARTS, getDayPartTimeRangeLabel} from "@/utils/dayParts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {ReportInsights} from "@/components/reports/report-insights.tsx";
import {
  buildSalesSummaryInsights,
  pctChange,
  sumChecks,
  sumGuests,
} from "@/api/reports/insights/sales.ts";

type Summary = ReturnType<typeof aggregateSalesSummary>;

const parseFilters = () => parseDateRangeFromParams(new URLSearchParams(window.location.search));

const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const fmtPct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString(undefined, {maximumFractionDigits: 1})} %`;

const th = "py-3 px-4 text-sm font-semibold text-neutral-700";
const td = "py-2.5 px-4 text-sm text-neutral-800";

const Bar = ({pct}: { pct: number }) => (
  <div className="hidden sm:block w-20 h-2 bg-neutral-100 rounded" data-xlsx-ignore>
    <div className="h-2 rounded bg-primary-500" style={{width: `${Math.min(100, Math.max(0, pct))}%`}}/>
  </div>
);

const Section = ({title, children}: { title: string; children: ReactNode }) => (
  <section className="break-inside-avoid">
    <h2 className="text-base font-semibold text-neutral-800 mb-2">{title}</h2>
    <div className="overflow-x-auto rounded-lg border border-neutral-200">{children}</div>
  </section>
);

export const SalesSummaryReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [previous, setPrevious] = useState<Summary | null>(null);
  const [outletSales, setOutletSales] = useState<ReturnType<typeof aggregateSalesByOutlet>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(parseFilters, []);
  const prevRange = useMemo(() => previousPeriod(filters), [filters]);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} → ${filters.endDate}` : undefined;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [orders, orderVoids] = await Promise.all([
          fetchPaidOrders(db, {...filters, fetches: SALES_SUMMARY_FETCHES}),
          fetchOrderVoids(db, filters),
        ]);

        setSummary(aggregateSalesSummary(orders, orderVoids));
        setOutletSales(aggregateSalesByOutlet(orders));

        if (prevRange) {
          try {
            const [prevOrders, prevVoids] = await Promise.all([
              fetchPaidOrders(db, {...prevRange, fetches: SALES_SUMMARY_FETCHES}),
              fetchOrderVoids(db, prevRange),
            ]);
            setPrevious(aggregateSalesSummary(prevOrders, prevVoids));
          } catch (err) {
            console.warn("Previous-period comparison unavailable", err);
            setPrevious(null);
          }
        }
      } catch (err) {
        console.error("Failed to load sales summary report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [db, filters, prevRange, t]);

  const insights = useMemo(
    () => summary
      ? buildSalesSummaryInsights(summary, previous, (k, p) => String(t(k, p as never)), (n) => withCurrency(n))
      : [],
    [summary, previous, t],
  );

  const title = t('titles.salesSummary');

  if (loading) {
    return (
      <ReportsLayout title={title} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('loading.salesSummary')}</div>
      </ReportsLayout>
    );
  }

  if (error || !summary) {
    return (
      <ReportsLayout title={title} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div>
      </ReportsLayout>
    );
  }

  const {
    totalNetSales: net,
    paymentSummary: pay,
    roundingBenefit,
    serviceCharges,
    taxes,
    totalDiscounts,
    totalCoupons,
    dayPartTotals,
    orderTypeBreakdown,
    totalVoids,
    discountRows,
  } = summary;

  const checks = sumChecks(summary);
  const guests = sumGuests(summary);
  const avgCheck = checks > 0 ? net / checks : 0;
  const perGuest = guests > 0 ? net / guests : 0;
  const discountsOnly = Math.max(0, totalDiscounts - totalCoupons);

  const prevChecks = previous ? sumChecks(previous) : 0;
  const prevAvg = previous && prevChecks > 0 ? previous.totalNetSales / prevChecks : 0;

  /** "vs 12 000 G (+8 %)" hint and tone for a KPI compared with the previous period. */
  const compare = (cur: number, prev: number | undefined, money = true, higherIsBetter = true) => {
    if (!previous || prev === undefined) return {};
    const change = pctChange(cur, prev);
    const prevText = money ? withCurrency(prev) : formatNumber(prev);
    if (change === null) return {hint: t('salesSummary.vsPrevious', {value: prevText, change: '—'})};
    const sign = change > 0 ? '+' : '';
    const good = higherIsBetter ? change >= 0 : change <= 0;
    return {
      hint: t('salesSummary.vsPrevious', {value: prevText, change: `${sign}${change} %`}),
      tone: (Math.abs(change) < 2 ? 'default' : good ? 'good' : 'bad') as ReportKpi['tone'],
    };
  };

  const kpis: ReportKpi[] = [
    {label: t('columns.netSales'), value: withDualCurrency(net), rawValue: net, ...compare(net, previous?.totalNetSales)},
    {label: t('columns.checks'), value: formatNumber(checks), rawValue: checks, rawFormat: 'integer', ...compare(checks, previous ? prevChecks : undefined, false)},
    {label: t('columns.avgCheck'), value: withCurrency(avgCheck), rawValue: avgCheck, ...compare(avgCheck, previous ? prevAvg : undefined)},
    {label: t('salesSummary.collected'), value: withDualCurrency(pay.amountCollected), rawValue: pay.amountCollected, hint: t('salesSummary.collectedHint')},
    {
      label: t('columns.covers'),
      value: formatNumber(guests),
      rawValue: guests,
      rawFormat: 'integer',
      hint: guests > 0 ? t('salesSummary.perGuest', {value: withCurrency(perGuest)}) : undefined,
    },
    {
      label: t('salesSummary.notCollected'),
      value: withDualCurrency(pay.deferredCharges),
      rawValue: pay.deferredCharges,
      tone: share(pay.deferredCharges, net) >= 20 ? 'warn' : 'default',
      hint: t('salesSummary.pctOfSales', {pct: fmtPct(share(pay.deferredCharges, net))}),
    },
    {
      label: t('salesSummary.discountsAndCoupons'),
      value: withDualCurrency(totalDiscounts),
      rawValue: totalDiscounts,
      tone: share(totalDiscounts, net + totalDiscounts) >= 5 ? 'warn' : 'default',
      hint: t('salesSummary.pctOfGross', {pct: fmtPct(share(totalDiscounts, net + totalDiscounts))}),
    },
    {
      label: t('reports.voids'),
      value: withDualCurrency(totalVoids),
      rawValue: totalVoids,
      tone: share(totalVoids, net + totalVoids) >= 3 ? 'warn' : 'default',
      ...(previous ? {hint: compare(totalVoids, previous.totalVoids, true, false).hint} : {}),
    },
  ];

  const nonCash = Object.entries(pay.nonCashBreakdown).sort((a, b) => b[1] - a[1]);
  const deferredBreakdown = Object.entries(pay.deferredBreakdown).sort((a, b) => b[1] - a[1]);

  const dayPartRows = DAY_PARTS.map((part) => ({
    label: part.label,
    range: getDayPartTimeRangeLabel(part.label),
    ...dayPartTotals[part.label],
  }));

  const orderTypes = [...orderTypeBreakdown].sort((a, b) => b.value - a.value);
  const orderTypeTotal = orderTypes.reduce((s, o) => s + o.value, 0);

  const outletTotals = outletSales.reduce(
    (acc, r) => ({
      quantity: acc.quantity + r.quantity,
      netSales: acc.netSales + r.netSales,
      discount: acc.discount + r.discount,
      tax: acc.tax + r.tax,
      total: acc.total + r.total,
    }),
    {quantity: 0, netSales: 0, discount: 0, tax: 0, total: 0},
  );

  const adjustmentRows: Array<{ label: string; value: number; prev?: number; higherIsBetter?: boolean }> = [
    {label: t('salesSummary.serviceCharges'), value: serviceCharges, prev: previous?.serviceCharges},
    {label: t('salesSummary.taxes'), value: taxes, prev: previous?.taxes},
    {label: t('metrics.discounts'), value: discountsOnly, prev: previous ? Math.max(0, previous.totalDiscounts - previous.totalCoupons) : undefined, higherIsBetter: false},
    {label: t('metrics.coupons'), value: totalCoupons, prev: previous?.totalCoupons, higherIsBetter: false},
    {label: t('reports.voids'), value: totalVoids, prev: previous?.totalVoids, higherIsBetter: false},
    {label: t('salesSummary.rounding'), value: roundingBenefit, prev: previous?.roundingBenefit},
  ];

  const changeCell = (cur: number, prev: number | undefined, higherIsBetter = true) => {
    if (prev === undefined) return <span className="text-neutral-400">—</span>;
    const change = pctChange(cur, prev);
    if (change === null) return <span className="text-neutral-400">—</span>;
    const good = higherIsBetter ? change >= 0 : change <= 0;
    return (
      <span className={cn(Math.abs(change) >= 2 && (good ? 'text-emerald-700' : 'text-red-700'))}>
        {change > 0 ? '+' : ''}{change} %
      </span>
    );
  };

  return (
    <ReportsLayout title={title} subtitle={subtitle}>
      {prevRange && (
        <p className="text-xs text-neutral-500 mb-3" data-xlsx-ignore>
          {t('salesSummary.comparedWith', {start: prevRange.startDate, end: prevRange.endDate})}
        </p>
      )}
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>

      <div className="space-y-6">
        <Section title={t('salesSummary.paymentsTitle')}>
          <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('salesSummary.paymentsTitle')}>
            <thead className="bg-neutral-50">
            <tr>
              <th className={cn(th, 'text-left')}>{t('salesSummary.line')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.amount')}</th>
              <th className={cn(th, 'text-right')}>{t('salesSummary.pctNetSales')}</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
            <tr className="font-semibold">
              <td className={td}>{t('salesSummary.collected')}</td>
              <td className={cn(td, 'text-right')}>{withCurrency(pay.amountCollected)}</td>
              <td className={cn(td, 'text-right')}>{fmtPct(share(pay.amountCollected, net))}</td>
            </tr>
            <tr>
              <td className={cn(td, 'pl-8')}>{t('labels.cashPaymentsNet')}</td>
              <td className={cn(td, 'text-right')}>{withCurrency(pay.cashPayments)}</td>
              <td className={cn(td, 'text-right')}>{fmtPct(share(pay.cashPayments, net))}</td>
            </tr>
            {nonCash.map(([label, value]) => (
              <tr key={`nc-${label}`}>
                <td className={cn(td, 'pl-8')}>{label}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(value)}</td>
                <td className={cn(td, 'text-right')}>{fmtPct(share(value, net))}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td className={td}>{t('salesSummary.notCollected')}</td>
              <td className={cn(td, 'text-right')}>{withCurrency(pay.deferredCharges)}</td>
              <td className={cn(td, 'text-right')}>{fmtPct(share(pay.deferredCharges, net))}</td>
            </tr>
            {deferredBreakdown.length > 0
              ? deferredBreakdown.map(([label, value]) => (
                <tr key={`df-${label}`}>
                  <td className={cn(td, 'pl-8')}>{label}</td>
                  <td className={cn(td, 'text-right')}>{withCurrency(value)}</td>
                  <td className={cn(td, 'text-right')}>{fmtPct(share(value, net))}</td>
                </tr>
              ))
              : (
                <>
                  <tr>
                    <td className={cn(td, 'pl-8')}>{t('salesSummary.room')}</td>
                    <td className={cn(td, 'text-right')}>{withCurrency(pay.roomCharges)}</td>
                    <td className={cn(td, 'text-right')}>{fmtPct(share(pay.roomCharges, net))}</td>
                  </tr>
                  <tr>
                    <td className={cn(td, 'pl-8')}>{t('salesSummary.credit')}</td>
                    <td className={cn(td, 'text-right')}>{withCurrency(pay.creditCharges)}</td>
                    <td className={cn(td, 'text-right')}>{fmtPct(share(pay.creditCharges, net))}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </Section>

        <Section title={t('salesSummary.dayPartsTitle')}>
          <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('salesSummary.dayPartsTitle')}>
            <thead className="bg-neutral-50">
            <tr>
              <th className={cn(th, 'text-left')}>{t('columns.dayPart')}</th>
              <th className={cn(th, 'text-left')}>{t('columns.hour')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.checks')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.covers')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.netSales')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.avgCheck')}</th>
              <th className={cn(th, 'text-right')}>%</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
            {dayPartRows.map((r) => (
              <tr key={r.label}>
                <td className={cn(td, 'font-medium')}>{r.label}</td>
                <td className={cn(td, 'text-neutral-500')}>{r.range}</td>
                <td className={cn(td, 'text-right')}>{formatNumber(r.checks)}</td>
                <td className={cn(td, 'text-right')}>{formatNumber(r.guests)}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(r.sales)}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(r.checks > 0 ? r.sales / r.checks : 0)}</td>
                <td className={cn(td, 'text-right')}>
                  <div className="flex items-center justify-end gap-2">
                    <Bar pct={share(r.sales, net)}/>
                    <span>{fmtPct(share(r.sales, net))}</span>
                  </div>
                </td>
              </tr>
            ))}
            </tbody>
            <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
            <tr>
              <td className={td}>{t('columns.total')}</td>
              <td className={td}/>
              <td className={cn(td, 'text-right')}>{formatNumber(checks)}</td>
              <td className={cn(td, 'text-right')}>{formatNumber(guests)}</td>
              <td className={cn(td, 'text-right')}>{withCurrency(net)}</td>
              <td className={cn(td, 'text-right')}>{withCurrency(avgCheck)}</td>
              <td className={cn(td, 'text-right')}>100 %</td>
            </tr>
            </tfoot>
          </table>
        </Section>

        {orderTypes.length > 0 && (
          <Section title={t('salesSummary.orderTypesTitle')}>
            <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('salesSummary.orderTypesTitle')}>
              <thead className="bg-neutral-50">
              <tr>
                <th className={cn(th, 'text-left')}>{t('salesSummary.orderType')}</th>
                <th className={cn(th, 'text-right')}>{t('columns.netSales')}</th>
                <th className={cn(th, 'text-right')}>%</th>
              </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
              {orderTypes.map((o) => (
                <tr key={o.label}>
                  <td className={cn(td, 'font-medium')}>{o.label}</td>
                  <td className={cn(td, 'text-right')}>{withCurrency(o.value)}</td>
                  <td className={cn(td, 'text-right')}>
                    <div className="flex items-center justify-end gap-2">
                      <Bar pct={share(o.value, orderTypeTotal)}/>
                      <span>{fmtPct(share(o.value, orderTypeTotal))}</span>
                    </div>
                  </td>
                </tr>
              ))}
              </tbody>
              <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
              <tr>
                <td className={td}>{t('columns.total')}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(orderTypeTotal)}</td>
                <td className={cn(td, 'text-right')}>100 %</td>
              </tr>
              </tfoot>
            </table>
          </Section>
        )}

        <Section title={t('salesSummary.adjustmentsTitle')}>
          <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('salesSummary.adjustmentsTitle')}>
            <thead className="bg-neutral-50">
            <tr>
              <th className={cn(th, 'text-left')}>{t('salesSummary.line')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.amount')}</th>
              <th className={cn(th, 'text-right')}>{t('salesSummary.pctNetSales')}</th>
              {previous && <th className={cn(th, 'text-right')}>{t('salesSummary.previousPeriod')}</th>}
              {previous && <th className={cn(th, 'text-right')}>{t('salesSummary.change')}</th>}
            </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
            {adjustmentRows.map((r) => (
              <tr key={r.label}>
                <td className={cn(td, 'font-medium')}>{r.label}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(r.value)}</td>
                <td className={cn(td, 'text-right')}>{fmtPct(share(r.value, net))}</td>
                {previous && <td className={cn(td, 'text-right text-neutral-500')}>{r.prev !== undefined ? withCurrency(r.prev) : '—'}</td>}
                {previous && <td className={cn(td, 'text-right')}>{changeCell(r.value, r.prev, r.higherIsBetter ?? true)}</td>}
              </tr>
            ))}
            </tbody>
          </table>
        </Section>

        <Section title={t('salesSummary.discountTypesTitle')}>
          <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('salesSummary.discountTypesTitle')}>
            <thead className="bg-neutral-50">
            <tr>
              <th className={cn(th, 'text-left')}>{t('salesSummary.discountType')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.quantity')}</th>
              <th className={cn(th, 'text-right')}>{t('columns.amount')}</th>
              <th className={cn(th, 'text-right')}>%</th>
            </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
            {discountRows.length > 0 ? (
              discountRows.map((d) => (
                <tr key={d.type}>
                  <td className={cn(td, 'font-medium')}>{d.type}</td>
                  <td className={cn(td, 'text-right')}>{formatNumber(d.quantity)}</td>
                  <td className={cn(td, 'text-right')}>{withCurrency(d.amount)}</td>
                  <td className={cn(td, 'text-right')}>{fmtPct(share(d.amount, totalDiscounts))}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-neutral-500">
                  {t('salesSummary.noDiscounts')}
                </td>
              </tr>
            )}
            </tbody>
            {discountRows.length > 0 && (
              <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
              <tr>
                <td className={td}>{t('columns.total')}</td>
                <td className={cn(td, 'text-right')}>{formatNumber(discountRows.reduce((s, d) => s + d.quantity, 0))}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(discountRows.reduce((s, d) => s + d.amount, 0))}</td>
                <td className={cn(td, 'text-right')}>100 %</td>
              </tr>
              </tfoot>
            )}
          </table>
        </Section>

        {outletSales.length > 0 && (
          <Section title={t('sections.salesByOutlet')}>
            <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('sections.salesByOutlet')}>
              <thead className="bg-neutral-50">
              <tr>
                <th className={cn(th, 'text-left')}>{t('columns.outlet')}</th>
                <th className={cn(th, 'text-right')}>{t('columns.quantity')}</th>
                <th className={cn(th, 'text-right')}>{t('columns.netSales')}</th>
                <th className={cn(th, 'text-right')}>{t('columns.discount')}</th>
                <th className={cn(th, 'text-right')}>{t('columns.tax')}</th>
                <th className={cn(th, 'text-right')}>{t('columns.total')}</th>
                <th className={cn(th, 'text-right')}>%</th>
              </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
              {[...outletSales].sort((a, b) => b.netSales - a.netSales).map((row) => (
                <tr key={row.outletId}>
                  <td className={cn(td, 'font-medium')}>
                    {row.outletId === UNCLASSIFIED_OUTLET_ID
                      ? t('labels.unclassifiedOutlet')
                      : (row.outletName ?? row.outletId)}
                  </td>
                  <td className={cn(td, 'text-right')}>{formatNumber(row.quantity)}</td>
                  <td className={cn(td, 'text-right')}>{withCurrency(row.netSales)}</td>
                  <td className={cn(td, 'text-right')}>{withCurrency(row.discount)}</td>
                  <td className={cn(td, 'text-right')}>{withCurrency(row.tax)}</td>
                  <td className={cn(td, 'text-right font-semibold')}>{withCurrency(row.total)}</td>
                  <td className={cn(td, 'text-right')}>
                    <div className="flex items-center justify-end gap-2">
                      <Bar pct={share(row.netSales, outletTotals.netSales)}/>
                      <span>{fmtPct(share(row.netSales, outletTotals.netSales))}</span>
                    </div>
                  </td>
                </tr>
              ))}
              </tbody>
              <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
              <tr>
                <td className={td}>{t('columns.total')}</td>
                <td className={cn(td, 'text-right')}>{formatNumber(outletTotals.quantity)}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(outletTotals.netSales)}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(outletTotals.discount)}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(outletTotals.tax)}</td>
                <td className={cn(td, 'text-right')}>{withCurrency(outletTotals.total)}</td>
                <td className={cn(td, 'text-right')}>100 %</td>
              </tr>
              </tfoot>
            </table>
          </Section>
        )}
      </div>
    </ReportsLayout>
  );
};
