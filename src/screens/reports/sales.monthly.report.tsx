import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {DateTime} from 'luxon';
import {ReportsLayout} from '@/screens/partials/reports.layout.tsx';
import {useDB} from '@/api/db/db.ts';
import {fiscalYearMonths, getMonthlySales, type FiscalYearFigures, type MonthFigures, type MonthlySalesData} from '@/api/reports/sales/monthly.ts';
import {buildMonthlyInsights} from '@/api/reports/insights/monthly.ts';
import {pctChange} from '@/api/reports/insights/sales.ts';
import {fiscalMonthIndex, fiscalYearLabel, fiscalYearStart} from '@/lib/fiscal-year.ts';
import {getAppTimezone, nowInAppTimezone} from '@/lib/datetime.ts';
import {cn, formatNumber, withCurrency, withDualCurrency} from '@/lib/utils.ts';
import {ReportKpis, type ReportKpi} from '@/components/reports/report-kpis.tsx';
import {ReportInsights} from '@/components/reports/report-insights.tsx';
import {SortableReportTable, type ReportColumn} from '@/components/reports/sortable-report-table.tsx';

type MonthRow = {index: number; cur: MonthFigures; prev: MonthFigures; cumCur: number; cumPrev: number; future: boolean};

const fyParam = () => {
  const n = Number(new URLSearchParams(window.location.search).get('fy'));
  return Number.isInteger(n) && n > 2000 && n < 2200 ? n : null;
};

const signed = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${formatNumber(n, 1)} %`);
const toneOf = (n: number | null) => (n === null ? '' : n >= 0 ? 'text-emerald-700' : 'text-red-700');

/** Net sales month by month over a fiscal year, against the previous one, and every fiscal year side by side. */
export const SalesMonthlyReport = () => {
  const {t, i18n} = useTranslation('reports');
  const db = useDB();
  const [data, setData] = useState<MonthlySalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const title = t('reports.salesMonthly');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await getMonthlySales(db));
    } catch (err) {
      console.error('Failed to load monthly sales', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const now = nowInAppTimezone();
  const startMonth = data?.startMonth ?? 10;
  const runningStart = fiscalYearStart(now, startMonth);
  const requested = fyParam();
  const start = requested ? DateTime.fromObject({year: requested, month: startMonth, day: 1}, {zone: getAppTimezone()}) : runningStart;
  const prevStart = start.minus({years: 1});
  const label = fiscalYearLabel(start);
  const prevLabel = fiscalYearLabel(prevStart);
  const isRunning = start.toISODate() === runningStart.toISODate();
  const isFuture = start > runningStart;
  const runningIndex = isFuture ? 0 : isRunning ? fiscalMonthIndex(now, startMonth) : 12;
  const runningProgress = isRunning ? (now.day - 1 + now.hour / 24) / now.daysInMonth! : 1;
  const monthName = useCallback(
    (m: MonthFigures) => DateTime.fromFormat(m.month, 'yyyy-LL').setLocale(i18n.language).toFormat('LLL yyyy'),
    [i18n.language],
  );

  const rows = useMemo((): MonthRow[] => {
    if (!data) return [];
    const cur = fiscalYearMonths(data.months, start);
    const prev = fiscalYearMonths(data.months, prevStart);
    let cumCur = 0;
    let cumPrev = 0;
    return cur.map((m, index) => {
      cumCur += m.netSales;
      cumPrev += prev[index].netSales;
      return {index, cur: m, prev: prev[index], cumCur, cumPrev, future: index > runningIndex};
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, start.toISODate()]);

  const insights = useMemo(
    () => buildMonthlyInsights(
      {current: rows.map((r) => r.cur), previous: rows.map((r) => r.prev), runningIndex, runningProgress, monthName},
      (k, p) => String(t(k, p as never)),
      withCurrency,
    ),
    [rows, runningIndex, runningProgress, monthName, t],
  );

  const subtitle = t('monthlyReport.subtitle', {
    label,
    from: start.setLocale(i18n.language).toFormat('LLL yyyy'),
    to: start.plus({months: 11}).setLocale(i18n.language).toFormat('LLL yyyy'),
    previous: prevLabel,
  });

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }
  if (error || !data) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', {error})}</div></ReportsLayout>;
  }

  // Like-for-like: the months elapsed so far this year (running month to date) against the same months last year.
  const elapsed = rows.filter((r) => !r.future);
  const ytd = elapsed.reduce((s, r) => s + r.cur.netSales, 0);
  const ytdChecks = elapsed.reduce((s, r) => s + r.cur.checks, 0);
  const prevSame = elapsed.reduce((s, r) => s + (isRunning && r.index === runningIndex ? r.prev.netSales * runningProgress : r.prev.netSales), 0);
  const ytdChange = pctChange(ytd, prevSame);
  const prevTotal = rows.reduce((s, r) => s + r.prev.netSales, 0);
  const best = [...elapsed].sort((a, b) => b.cur.netSales - a.cur.netSales)[0];
  const maxBar = Math.max(1, ...rows.map((r) => Math.max(r.cur.netSales, r.prev.netSales)));

  const kpis: ReportKpi[] = [
    {label: isRunning ? t('monthlyReport.ytd') : t('monthlyReport.yearTotal'), value: withDualCurrency(ytd), rawValue: ytd, hint: t('monthlyReport.fy', {label})},
    {
      label: t('monthlyReport.vsPrevious'),
      value: signed(ytdChange),
      rawValue: ytdChange === null ? undefined : ytdChange / 100,
      rawFormat: 'percent',
      tone: ytdChange === null ? undefined : ytdChange >= 0 ? 'good' : 'bad',
      hint: t('monthlyReport.previousSame', {amount: withCurrency(prevSame), label: prevLabel}),
    },
    {label: t('monthlyReport.avgCheck'), value: withCurrency(ytdChecks > 0 ? ytd / ytdChecks : 0), rawValue: ytdChecks > 0 ? ytd / ytdChecks : 0, hint: t('monthlyReport.checks', {count: ytdChecks})},
    {label: t('monthlyReport.bestMonth'), value: best && best.cur.netSales > 0 ? monthName(best.cur) : '—', hint: best && best.cur.netSales > 0 ? withCurrency(best.cur.netSales) : undefined},
    {label: t('monthlyReport.previousTotal', {label: prevLabel}), value: withCurrency(prevTotal), rawValue: prevTotal},
  ];

  const sum = (rs: MonthRow[], f: (r: MonthRow) => number) => rs.reduce((s, r) => s + f(r), 0);
  const columns: ReportColumn<MonthRow>[] = [
    {
      key: 'month', header: t('monthlyReport.month'), sortValue: (r) => r.index,
      render: (r) => (
        <span className="font-medium">
          {monthName(r.cur)}
          {isRunning && r.index === runningIndex && <span className="ml-2 text-xs rounded bg-sky-100 px-1.5 py-0.5 text-sky-800">{t('monthlyReport.inProgress')}</span>}
        </span>
      ),
      total: () => t('columns.total'),
      cellClass: (r) => (r.future ? 'text-neutral-400' : ''),
    },
    {key: 'net', header: t('monthlyReport.netFy', {label}), align: 'right', sortValue: (r) => r.cur.netSales, render: (r) => <span className="font-semibold">{withCurrency(r.cur.netSales)}</span>, total: (rs) => withCurrency(sum(rs, (r) => r.cur.netSales))},
    {key: 'prev', header: t('monthlyReport.netFy', {label: prevLabel}), align: 'right', sortValue: (r) => r.prev.netSales, render: (r) => withCurrency(r.prev.netSales), total: (rs) => withCurrency(sum(rs, (r) => r.prev.netSales))},
    {key: 'diff', header: t('monthlyReport.difference'), align: 'right', sortValue: (r) => r.cur.netSales - r.prev.netSales, render: (r) => (r.future ? '—' : withCurrency(r.cur.netSales - r.prev.netSales)), cellClass: (r) => (r.future ? '' : toneOf(r.cur.netSales - r.prev.netSales))},
    {key: 'pct', header: t('monthlyReport.change'), align: 'right', sortValue: (r) => pctChange(r.cur.netSales, r.prev.netSales) ?? -9999, render: (r) => (r.future ? '—' : signed(pctChange(r.cur.netSales, r.prev.netSales))), cellClass: (r) => (r.future ? '' : toneOf(pctChange(r.cur.netSales, r.prev.netSales)))},
    {key: 'checks', header: t('columns.orders'), align: 'right', sortValue: (r) => r.cur.checks, render: (r) => formatNumber(r.cur.checks), total: (rs) => formatNumber(sum(rs, (r) => r.cur.checks))},
    {key: 'prevChecks', header: t('monthlyReport.ordersFy', {label: prevLabel}), align: 'right', sortValue: (r) => r.prev.checks, render: (r) => formatNumber(r.prev.checks), total: (rs) => formatNumber(sum(rs, (r) => r.prev.checks))},
    {key: 'avg', header: t('monthlyReport.avgCheck'), align: 'right', sortValue: (r) => (r.cur.checks ? r.cur.netSales / r.cur.checks : 0), render: (r) => (r.cur.checks ? withCurrency(r.cur.netSales / r.cur.checks) : '—')},
    {key: 'perDay', header: t('monthlyReport.perDay'), align: 'right', sortValue: (r) => (r.cur.openDays ? r.cur.netSales / r.cur.openDays : 0), render: (r) => (r.cur.openDays ? withCurrency(r.cur.netSales / r.cur.openDays) : '—')},
    {key: 'cum', header: t('monthlyReport.cumulative'), align: 'right', render: (r) => (r.future ? '—' : withCurrency(r.cumCur))},
    {key: 'cumPrev', header: t('monthlyReport.cumulativeFy', {label: prevLabel}), align: 'right', render: (r) => withCurrency(r.cumPrev)},
  ];

  const yearColumns: ReportColumn<FiscalYearFigures & {growth: number | null}>[] = [
    {
      key: 'label', header: t('monthlyReport.fiscalYear'), sortValue: (y) => y.start,
      render: (y) => (
        <span className="font-medium">
          {y.label}
          {y.months < 12 && <span className="ml-2 text-xs text-neutral-500">{t('monthlyReport.monthsWithSales', {count: y.months})}</span>}
        </span>
      ),
    },
    {key: 'net', header: t('columns.netSales'), align: 'right', sortValue: (y) => y.netSales, render: (y) => <span className="font-semibold">{withCurrency(y.netSales)}</span>},
    {key: 'growth', header: t('monthlyReport.vsPreviousYear'), align: 'right', sortValue: (y) => y.growth ?? -9999, render: (y) => signed(y.growth), cellClass: (y) => toneOf(y.growth)},
    {key: 'checks', header: t('columns.orders'), align: 'right', sortValue: (y) => y.checks, render: (y) => formatNumber(y.checks)},
    {key: 'avg', header: t('monthlyReport.avgCheck'), align: 'right', render: (y) => (y.checks ? withCurrency(y.netSales / y.checks) : '—')},
    {key: 'monthly', header: t('monthlyReport.monthlyAverage'), align: 'right', render: (y) => (y.months ? withCurrency(y.netSales / y.months) : '—')},
  ];
  const years = data.years.map((y, i) => ({...y, growth: i > 0 && data.years[i - 1].months === 12 && y.months === 12 ? pctChange(y.netSales, data.years[i - 1].netSales) : null}));

  return (
    <ReportsLayout title={title} subtitle={subtitle} onRefresh={fetchData}>
      <p className="text-sm text-neutral-600 mb-4" data-xlsx-ignore>{t('monthlyReport.explanation')}</p>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>

      <div className="mb-6 rounded-lg border border-neutral-200 p-4" data-xlsx-ignore>
        <div className="flex gap-4 text-xs text-neutral-600 mb-3">
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-sky-600"/>{label}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm bg-neutral-300"/>{prevLabel}</span>
        </div>
        <div className="grid grid-cols-12 gap-1 sm:gap-2 items-end h-44">
          {rows.map((r) => (
            <div key={r.cur.month} className="flex h-full items-end justify-center gap-0.5" title={`${monthName(r.cur)} : ${withCurrency(r.cur.netSales)} / ${withCurrency(r.prev.netSales)}`}>
              <div className="w-1/2 max-w-4 rounded-t bg-sky-600" style={{height: `${(r.cur.netSales / maxBar) * 100}%`}}/>
              <div className="w-1/2 max-w-4 rounded-t bg-neutral-300" style={{height: `${(r.prev.netSales / maxBar) * 100}%`}}/>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-12 gap-1 sm:gap-2 mt-1">
          {rows.map((r) => (
            <div key={r.cur.month} className={cn('text-center text-[10px] sm:text-xs text-neutral-500 truncate', r.future && 'text-neutral-300')}>
              {DateTime.fromFormat(r.cur.month, 'yyyy-LL').setLocale(i18n.language).toFormat('LLL')}
            </div>
          ))}
        </div>
      </div>

      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('monthlyReport.byMonth')}</h2>
      <SortableReportTable rows={rows} columns={columns} rowKey={(r) => r.cur.month} initialSort={{key: 'month', dir: 'asc'}} xlsxTitle={t('monthlyReport.byMonth')}/>

      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('monthlyReport.byYear')}</h2>
      <SortableReportTable rows={years} columns={yearColumns} rowKey={(y) => y.start} initialSort={{key: 'label', dir: 'desc'}} emptyText={t('insights.monthly.none')} xlsxTitle={t('monthlyReport.byYear')}/>
      <p className="text-xs text-neutral-500" data-xlsx-ignore>{t('monthlyReport.note')}</p>
    </ReportsLayout>
  );
};
