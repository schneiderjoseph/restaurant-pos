import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ReportsLayout} from '@/screens/partials/reports.layout.tsx';
import {useDB} from '@/api/db/db.ts';
import {parseDateRangeFromParams} from '@/api/reports/shared/filters.ts';
import {getShiftReport, type ShiftRow} from '@/api/reports/operations/shifts.ts';
import {toLuxonDateTime} from '@/lib/datetime.ts';
import {formatNumber, withCurrency, withDualCurrency} from '@/lib/utils.ts';
import {ReportKpis, type ReportKpi} from '@/components/reports/report-kpis.tsx';
import {ReportInsights, type ReportInsight} from '@/components/reports/report-insights.tsx';
import {SortableReportTable, type ReportColumn} from '@/components/reports/sortable-report-table.tsx';
import {GroupTable, groupSum, type GroupRow} from '@/components/reports/group-table.tsx';
import {listNames} from '@/api/reports/insights/credit.ts';

const parseFilters = () => parseDateRangeFromParams(new URLSearchParams(window.location.search));

/** A session open this long probably means a forgotten clock-out. */
export const LONG_SHIFT_HOURS = 14;

const fmtDateTime = (d: Date | null) => (d ? toLuxonDateTime(d as never).toFormat('yyyy-LL-dd HH:mm') : '—');
const fmtHours = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${String(m).padStart(2, '0')}`;
};

/** Shift report: what each employee collected during each clock-in session. */
export const ShiftsReport = () => {
  const {t} = useTranslation('reports');
  const db = useDB();
  const filters = useMemo(parseFilters, []);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} → ${filters.endDate}` : undefined;
  const title = t('reports.shifts');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setRows(await getShiftReport(db, filters));
    } catch (err) {
      console.error('Failed to load shift report', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, filters, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const sessions = rows.filter((r) => r.clockIn);
  const outside = rows.filter((r) => !r.clockIn);
  const totals = rows.reduce(
    (acc, r) => ({
      collected: acc.collected + r.collected,
      cash: acc.cash + r.cash,
      other: acc.other + r.otherTotal,
      deferred: acc.deferred + r.deferred,
      net: acc.net + r.netSales,
      checks: acc.checks + r.checks,
      tips: acc.tips + r.tips,
    }),
    {collected: 0, cash: 0, other: 0, deferred: 0, net: 0, checks: 0, tips: 0},
  );

  const byEmployee = useMemo(() => groupSum(rows, (r) => r.userName, (r) => r.collected), [rows]);

  const tenderRows = useMemo((): GroupRow[] => {
    const map = new Map<string, GroupRow>();
    const add = (name: string, amount: number, count: number) => {
      if (amount <= 0) return;
      const g = map.get(name) ?? {name, count: 0, amount: 0};
      g.amount += amount;
      g.count += count;
      map.set(name, g);
    };
    rows.forEach((r) => {
      add(t('labels.cashPayments'), r.cash, r.cash > 0 ? 1 : 0);
      Object.entries(r.otherTenders).forEach(([name, amount]) => add(name, amount, 1));
    });
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [rows, t]);

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (rows.length === 0) {
      out.push({id: 'none', severity: 'info', text: t('insights.shifts.none')});
      return out;
    }
    const tt = (k: string, p?: Record<string, unknown>) => String(t(k, p as never));
    const open = sessions.filter((r) => r.active);
    if (open.length) {
      out.push({id: 'open', severity: 'info', text: t('insights.shifts.open', {count: open.length, names: listNames(open.map((r) => r.userName), tt)})});
    }
    const long = sessions.filter((r) => r.durationSeconds > LONG_SHIFT_HOURS * 3600);
    if (long.length) {
      out.push({id: 'long', severity: 'warn', text: t('insights.shifts.long', {count: long.length, hours: LONG_SHIFT_HOURS, names: listNames(long.map((r) => `${r.userName} (${fmtHours(r.durationSeconds)})`), tt)})});
    }
    const outsideAmount = outside.reduce((s, r) => s + r.collected + r.deferred, 0);
    if (outside.length && outsideAmount > 0) {
      out.push({id: 'outside', severity: 'warn', text: t('insights.shifts.outside', {
        count: outside.reduce((s, r) => s + r.checks, 0),
        amount: withCurrency(outsideAmount),
        names: listNames(outside.map((r) => r.userName), tt),
      })});
    }
    if (byEmployee.length > 1) {
      const top = byEmployee[0];
      out.push({id: 'top', severity: 'info', text: t('insights.shifts.top', {name: top.name, amount: withCurrency(top.amount), pct: totals.collected > 0 ? Math.round((top.amount / totals.collected) * 100) : 0})});
    }
    const idle = sessions.filter((r) => r.checks === 0 && r.durationSeconds >= 3600);
    if (idle.length) {
      out.push({id: 'idle', severity: 'info', text: t('insights.shifts.noSales', {count: idle.length, names: listNames(idle.map((r) => r.userName), tt)})});
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, byEmployee, totals.collected, t]);

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', {error})}</div></ReportsLayout>;
  }

  const sumOf = (rs: ShiftRow[], f: (r: ShiftRow) => number) => rs.reduce((acc, r) => acc + f(r), 0);
  const columns: ReportColumn<ShiftRow>[] = [
    {
      key: 'name',
      header: t('shiftsReport.employee'),
      sortValue: (r) => r.userName.toLowerCase(),
      searchValue: (r) => `${r.userName} ${r.role ?? ''}`,
      render: (r) => (
        <span className="font-medium">
          {r.userName}
          {!r.clockIn && <span className="ml-2 text-xs rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{t('shiftsReport.outside')}</span>}
          {r.active && <span className="ml-2 text-xs rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">{t('shiftsReport.inProgress')}</span>}
        </span>
      ),
      total: () => t('columns.total'),
    },
    {key: 'role', header: t('columns.role'), render: (r) => r.role || '—'},
    {key: 'in', header: t('shiftsReport.clockIn'), sortValue: (r) => r.clockIn?.getTime() ?? 0, render: (r) => fmtDateTime(r.clockIn)},
    {key: 'out', header: t('shiftsReport.clockOut'), sortValue: (r) => r.clockOut?.getTime() ?? 0, render: (r) => (r.active ? t('shiftsReport.inProgress') : fmtDateTime(r.clockOut))},
    {
      key: 'duration',
      header: t('shiftsReport.duration'),
      align: 'right',
      sortValue: (r) => r.durationSeconds,
      render: (r) => (r.clockIn ? fmtHours(r.durationSeconds) : '—'),
      cellClass: (r) => (r.durationSeconds > LONG_SHIFT_HOURS * 3600 ? 'text-amber-700 font-semibold' : ''),
    },
    {key: 'checks', header: t('columns.orders'), align: 'right', sortValue: (r) => r.checks, render: (r) => formatNumber(r.checks), total: (rs) => formatNumber(sumOf(rs, (r) => r.checks))},
    {key: 'cash', header: t('labels.cashPayments'), align: 'right', sortValue: (r) => r.cash, render: (r) => withCurrency(r.cash), total: (rs) => withCurrency(sumOf(rs, (r) => r.cash))},
    {key: 'other', header: t('shiftsReport.otherTenders'), align: 'right', sortValue: (r) => r.otherTotal, render: (r) => withCurrency(r.otherTotal), total: (rs) => withCurrency(sumOf(rs, (r) => r.otherTotal))},
    {key: 'collected', header: t('salesSummary.collected'), align: 'right', sortValue: (r) => r.collected, render: (r) => <span className="font-semibold">{withCurrency(r.collected)}</span>, total: (rs) => withCurrency(sumOf(rs, (r) => r.collected))},
    {key: 'deferred', header: t('shiftsReport.deferred'), align: 'right', sortValue: (r) => r.deferred, render: (r) => withCurrency(r.deferred), total: (rs) => withCurrency(sumOf(rs, (r) => r.deferred))},
    {key: 'net', header: t('columns.netSales'), align: 'right', sortValue: (r) => r.netSales, render: (r) => withCurrency(r.netSales), total: (rs) => withCurrency(sumOf(rs, (r) => r.netSales))},
    {key: 'tips', header: t('reports.tips'), align: 'right', sortValue: (r) => r.tips, render: (r) => withCurrency(r.tips), total: (rs) => withCurrency(sumOf(rs, (r) => r.tips))},
    {
      key: 'perHour',
      header: t('shiftsReport.perHour'),
      align: 'right',
      sortValue: (r) => (r.durationSeconds > 0 ? r.netSales / (r.durationSeconds / 3600) : 0),
      render: (r) => (r.clockIn && r.durationSeconds >= 600 ? withCurrency(r.netSales / (r.durationSeconds / 3600)) : '—'),
    },
  ];

  const kpis: ReportKpi[] = [
    {label: t('salesSummary.collected'), value: withDualCurrency(totals.collected), rawValue: totals.collected, hint: t('cashReport.cashShare', {pct: totals.collected > 0 ? Math.round((totals.cash / totals.collected) * 100) : 0})},
    {label: t('labels.cashPayments'), value: withDualCurrency(totals.cash), rawValue: totals.cash},
    {label: t('shiftsReport.deferred'), value: withDualCurrency(totals.deferred), rawValue: totals.deferred},
    {label: t('shiftsReport.sessions'), value: formatNumber(sessions.length), rawValue: sessions.length, rawFormat: 'integer', hint: t('shiftsReport.employees', {count: byEmployee.length})},
  ];

  return (
    <ReportsLayout title={title} subtitle={subtitle} onRefresh={fetchData}>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
        {byEmployee.length > 0 && <GroupTable title={t('shiftsReport.byEmployee')} nameHeader={t('shiftsReport.employee')} rows={byEmployee} countHeader={t('shiftsReport.sessionsCount')} amountHeader={t('salesSummary.collected')}/>}
        {tenderRows.length > 0 && <GroupTable title={t('advancedReport.byTender')} nameHeader={t('advancedReport.tender')} rows={tenderRows} countHeader={t('shiftsReport.sessionsCount')}/>}
      </div>
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('shiftsReport.detail')}</h2>
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        initialSort={{key: 'in', dir: 'desc'}}
        searchPlaceholder={t('shiftsReport.search')}
        emptyText={t('insights.shifts.none')}
        xlsxTitle={t('shiftsReport.detail')}
      />
      <p className="text-xs text-neutral-500" data-xlsx-ignore>{t('shiftsReport.note')}</p>
    </ReportsLayout>
  );
};
