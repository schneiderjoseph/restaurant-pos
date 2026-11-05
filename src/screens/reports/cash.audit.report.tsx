import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ReportsLayout} from '@/screens/partials/reports.layout.tsx';
import {useDB} from '@/api/db/db.ts';
import {parseDateRangeFromParams} from '@/api/reports/shared/filters.ts';
import {getCashSettlementAudit} from '@/api/reports/operations/cash-audit.ts';
import {toLuxonDateTime} from '@/lib/datetime.ts';
import {formatNumber, withCurrency, withDualCurrency} from '@/lib/utils.ts';
import {ReportKpis, type ReportKpi} from '@/components/reports/report-kpis.tsx';
import {ReportInsights, type ReportInsight} from '@/components/reports/report-insights.tsx';
import {SortableReportTable, type ReportColumn} from '@/components/reports/sortable-report-table.tsx';
import {GroupTable, groupSum} from '@/components/reports/group-table.tsx';

type Audit = Awaited<ReturnType<typeof getCashSettlementAudit>>;
type Modification = Audit['modifications'][number];

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const window_ = Number(params.get('window'));
  return {
    ...parseDateRangeFromParams(params),
    windowMinutes: Number.isFinite(window_) && window_ > 0 ? window_ : 30,
  };
};

/** Row cap: high enough to never truncate a normal period. */
const ROW_LIMIT = 5000;

/**
 * Cash orders where an item was removed or the payment was changed shortly
 * before the order was paid — the classic pattern of cash being pocketed.
 */
export const CashAuditReport = () => {
  const {t} = useTranslation('reports');
  const db = useDB();
  const filters = useMemo(parseFilters, []);
  const [audit, setAudit] = useState<Audit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} → ${filters.endDate}` : undefined;
  const title = t('reports.cashAudit');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setAudit(await getCashSettlementAudit(db, {
        startDate: filters.startDate,
        endDate: filters.endDate,
        minutesBeforeClose: filters.windowMinutes,
        limit: ROW_LIMIT,
      }));
    } catch (err) {
      console.error('Failed to load cash audit', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, filters, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const mods = useMemo(() => audit?.modifications ?? [], [audit]);
  const cashTotal = useMemo(() => (audit?.cashOrders ?? []).reduce((s, o) => s + (Number(o.cashAmount) || 0), 0), [audit]);
  const byCashier = useMemo(() => groupSum(mods, (m) => m.cashierName || t('voidsReport.unknown'), () => 0), [mods, t]);
  const byType = useMemo(() => groupSum(mods, (m) => typeLabel(m), () => 0), [mods]); // eslint-disable-line react-hooks/exhaustive-deps

  function typeLabel(m: Modification): string {
    if (m.modificationType === 'item_removed') return t('cashAudit.itemRemoved');
    return m.module || t('cashAudit.paymentChange');
  }

  const flaggedOrders = audit?.flaggedOrderCount ?? 0;
  const cashOrders = audit?.cashOrderCount ?? 0;
  const flaggedPct = cashOrders > 0 ? Math.round((flaggedOrders / cashOrders) * 1000) / 10 : 0;

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (!audit) return out;
    if (mods.length === 0) {
      out.push({id: 'clean', severity: 'good', text: t('insights.cashAudit.clean', {count: cashOrders, minutes: filters.windowMinutes})});
      return out;
    }
    out.push({id: 'flagged', severity: flaggedPct >= 5 ? 'warn' : 'info', text: t('insights.cashAudit.flagged', {count: flaggedOrders, total: cashOrders, pct: flaggedPct, minutes: filters.windowMinutes})});
    if (byCashier.length >= 2 && byCashier[0].count / mods.length >= 0.5) {
      out.push({id: 'concentration', severity: 'warn', text: t('insights.cashAudit.concentration', {name: byCashier[0].name, count: byCashier[0].count, pct: Math.round((byCashier[0].count / mods.length) * 100)})});
    } else if (byCashier[0]) {
      out.push({id: 'top', severity: 'info', text: t('insights.cashAudit.top', {name: byCashier[0].name, count: byCashier[0].count})});
    }
    const lastMinute = mods.filter((m) => (m.minutesBeforeClose ?? 99) <= 2);
    if (lastMinute.length) {
      out.push({id: 'last-minute', severity: 'warn', text: t('insights.cashAudit.lastMinute', {count: lastMinute.length})});
    }
    return out;
  }, [audit, mods, byCashier, cashOrders, flaggedOrders, flaggedPct, filters.windowMinutes, t]);

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', {error})}</div></ReportsLayout>;
  }

  const details = (m: Modification) => {
    const p = (m.payload ?? {}) as Record<string, unknown>;
    if (typeof p.itemName === 'string') return p.itemName;
    const parts = Object.entries(p)
      .filter(([k, v]) => !/order/i.test(k) && v != null && typeof v !== 'object')
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${String(v)}`);
    return parts.join(' · ') || '—';
  };

  const columns: ReportColumn<Modification>[] = [
    {key: 'order', header: t('columns.order'), sortValue: (m) => m.invoiceNumber ?? 0, searchValue: (m) => String(m.invoiceNumber ?? m.orderId), render: (m) => (m.invoiceNumber ? `#${m.invoiceNumber}` : m.orderId)},
    {key: 'at', header: t('columns.date'), sortValue: (m) => (m.createdAt ? toLuxonDateTime(m.createdAt as never).toMillis() : 0), render: (m) => (m.createdAt ? toLuxonDateTime(m.createdAt as never).toFormat('yyyy-LL-dd HH:mm') : '—')},
    {key: 'cashier', header: t('metrics.cashier'), sortValue: (m) => m.cashierName ?? '', searchValue: (m) => m.cashierName ?? '', render: (m) => m.cashierName || '—'},
    {key: 'by', header: t('cashAudit.changedBy'), sortValue: (m) => m.by ?? '', searchValue: (m) => m.by ?? '', render: (m) => m.by || '—'},
    {key: 'type', header: t('cashAudit.change'), sortValue: typeLabel, searchValue: typeLabel, render: typeLabel},
    {
      key: 'minutes',
      header: t('cashAudit.minutesBefore'),
      align: 'right',
      sortValue: (m) => m.minutesBeforeClose ?? 0,
      render: (m) => formatNumber(m.minutesBeforeClose ?? 0),
      cellClass: (m) => ((m.minutesBeforeClose ?? 99) <= 2 ? 'text-red-700 font-semibold' : ''),
    },
    {key: 'details', header: t('columns.details'), searchValue: details, render: details, cellClass: () => 'whitespace-normal max-w-[320px]'},
  ];

  const kpis: ReportKpi[] = [
    {label: t('cashAudit.cashOrders'), value: formatNumber(cashOrders), rawValue: cashOrders, rawFormat: 'integer', hint: withCurrency(cashTotal)},
    {label: t('cashAudit.flaggedOrders'), value: formatNumber(flaggedOrders), rawValue: flaggedOrders, rawFormat: 'integer', tone: flaggedOrders === 0 ? 'good' : flaggedPct >= 5 ? 'bad' : 'warn'},
    {label: t('cashAudit.flaggedShare'), value: `${flaggedPct} %`, rawValue: flaggedPct / 100, rawFormat: 'percent'},
    {label: t('cashAudit.cashCollected'), value: withDualCurrency(cashTotal), rawValue: cashTotal},
  ];

  return (
    <ReportsLayout title={title} subtitle={subtitle} onRefresh={fetchData}>
      <p className="text-sm text-neutral-600 mb-4" data-xlsx-ignore>{t('cashAudit.explanation', {minutes: filters.windowMinutes})}</p>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      {mods.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
          <GroupTable title={t('financeReport.byCashier')} nameHeader={t('metrics.cashier')} rows={byCashier} showAmount={false} countHeader={t('cashAudit.changes')}/>
          <GroupTable title={t('cashAudit.byType')} nameHeader={t('cashAudit.change')} rows={byType} showAmount={false} countHeader={t('cashAudit.changes')}/>
        </div>
      )}
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('cashAudit.detail')}</h2>
      <SortableReportTable
        rows={mods}
        columns={columns}
        rowKey={(m) => `${m.orderId}-${m.modificationType}-${m.minutesBeforeClose}`}
        initialSort={{key: 'minutes', dir: 'asc'}}
        searchPlaceholder={t('cashAudit.search')}
        emptyText={t('cashAudit.empty')}
        xlsxTitle={t('cashAudit.detail')}
      />
    </ReportsLayout>
  );
};
