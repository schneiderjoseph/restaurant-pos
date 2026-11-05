import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ReportsLayout} from '@/screens/partials/reports.layout.tsx';
import {useDB} from '@/api/db/db.ts';
import {parseDateRangeFromParams} from '@/api/reports/shared/filters.ts';
import {getKitchenStationDelays, getPrepTimesByOrderType} from '@/api/reports/operations/kitchen-timing.ts';
import {formatNumber} from '@/lib/utils.ts';
import {ReportKpis, type ReportKpi} from '@/components/reports/report-kpis.tsx';
import {ReportInsights, type ReportInsight} from '@/components/reports/report-insights.tsx';
import {SortableReportTable, type ReportColumn} from '@/components/reports/sortable-report-table.tsx';

type DurationRow = {name: string; orderCount: number; avgSeconds: number; medianSeconds: number; p90Seconds: number};

/** A 90th percentile above this many minutes means some guests wait far too long. */
export const SLOW_P90_MINUTES = 30;

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const clampHour = (v: string | null, fallback: number) => {
    const n = Number(v);
    return v !== null && Number.isFinite(n) ? Math.min(24, Math.max(0, Math.round(n))) : fallback;
  };
  return {
    ...parseDateRangeFromParams(params),
    startHour: clampHour(params.get('from_hour'), 0),
    endHour: clampHour(params.get('to_hour'), 24),
  };
};

const minutes = (seconds: number) => seconds / 60;
/** Plain number (no unit) so Excel keeps it numeric; the unit is in the header. */
const fmtMin = (seconds: number) => formatNumber(Math.round(minutes(seconds) * 10) / 10, 1);

const weightedAvg = (rows: DurationRow[]) => {
  const n = rows.reduce((s, r) => s + r.orderCount, 0);
  return n > 0 ? rows.reduce((s, r) => s + r.avgSeconds * r.orderCount, 0) / n : 0;
};

/**
 * Kitchen timing: ticket time per order type (opening → payment) and prep
 * time per kitchen, stage and category (sent to kitchen → done).
 */
export const KitchenTimingReport = () => {
  const {t} = useTranslation('reports');
  const db = useDB();
  const filters = useMemo(parseFilters, []);
  const [byOrderType, setByOrderType] = useState<DurationRow[]>([]);
  const [stations, setStations] = useState<{itemCount: number; byKitchen: DurationRow[]; byStage: DurationRow[]; byCategory: DurationRow[]}>({itemCount: 0, byKitchen: [], byStage: [], byCategory: []});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hoursLabel = `${String(filters.startHour).padStart(2, '0')}:00–${String(filters.endHour).padStart(2, '0')}:00`;
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} → ${filters.endDate} · ${hoursLabel}` : hoursLabel;
  const title = t('reports.kitchenTiming');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const range = {startDate: filters.startDate, endDate: filters.endDate};
      const [prep, delays] = await Promise.all([
        getPrepTimesByOrderType(db, range),
        getKitchenStationDelays(db, {...range, startHour: filters.startHour, endHour: filters.endHour}),
      ]);
      setByOrderType(prep.byOrderType.map((r) => ({...r, name: r.orderType})));
      setStations({itemCount: delays.itemCount, byKitchen: delays.byKitchen, byStage: delays.byStage, byCategory: delays.byCategory});
    } catch (err) {
      console.error('Failed to load kitchen timing', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, filters, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const ticketAvg = weightedAvg(byOrderType);
  const prepAvg = weightedAvg(stations.byKitchen);
  const ticketsTimed = byOrderType.reduce((s, r) => s + r.orderCount, 0);

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (ticketsTimed === 0 && stations.itemCount === 0) {
      out.push({id: 'none', severity: 'info', text: t('insights.kitchen.none')});
      return out;
    }
    const kitchens = stations.byKitchen.filter((k) => k.orderCount >= 5);
    if (kitchens.length >= 2) {
      const slow = kitchens[0];
      const fast = kitchens[kitchens.length - 1];
      out.push({id: 'slowest-kitchen', severity: slow.avgSeconds > fast.avgSeconds * 1.5 ? 'warn' : 'info', text: t('insights.kitchen.slowestKitchen', {name: slow.name, avg: fmtMin(slow.avgSeconds), fast: fast.name, fastAvg: fmtMin(fast.avgSeconds)})});
    }
    const slowTypes = byOrderType.filter((r) => r.orderCount >= 5 && minutes(r.p90Seconds) > SLOW_P90_MINUTES);
    if (slowTypes.length) {
      out.push({id: 'slow-p90', severity: 'warn', text: t('insights.kitchen.slowP90', {limit: SLOW_P90_MINUTES, names: slowTypes.map((r) => `${r.name} (${fmtMin(r.p90Seconds)} min)`).join(', ')})});
    }
    const categories = stations.byCategory.filter((c) => c.orderCount >= 5);
    if (categories[0]) {
      out.push({id: 'slowest-category', severity: 'info', text: t('insights.kitchen.slowestCategory', {name: categories[0].name, avg: fmtMin(categories[0].avgSeconds), count: categories[0].orderCount})});
    }
    if (ticketsTimed > 0) {
      out.push({id: 'ticket', severity: 'info', text: t('insights.kitchen.ticketAverage', {avg: fmtMin(ticketAvg), count: ticketsTimed})});
    }
    return out;
  }, [byOrderType, stations, ticketsTimed, ticketAvg, t]);

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', {error})}</div></ReportsLayout>;
  }

  const durationColumns = (nameHeader: string, countHeader: string): ReportColumn<DurationRow>[] => [
    {key: 'name', header: nameHeader, sortValue: (r) => r.name.toLowerCase(), searchValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span>},
    {key: 'count', header: countHeader, align: 'right', sortValue: (r) => r.orderCount, render: (r) => formatNumber(r.orderCount), total: (rs) => formatNumber(rs.reduce((s, r) => s + r.orderCount, 0))},
    {key: 'avg', header: t('kitchenTiming.avg'), align: 'right', sortValue: (r) => r.avgSeconds, render: (r) => fmtMin(r.avgSeconds), total: (rs) => fmtMin(weightedAvg(rs))},
    {key: 'median', header: t('kitchenTiming.median'), align: 'right', sortValue: (r) => r.medianSeconds, render: (r) => fmtMin(r.medianSeconds)},
    {
      key: 'p90',
      header: t('kitchenTiming.p90'),
      align: 'right',
      sortValue: (r) => r.p90Seconds,
      render: (r) => fmtMin(r.p90Seconds),
      cellClass: (r) => (minutes(r.p90Seconds) > SLOW_P90_MINUTES ? 'text-red-700 font-semibold' : ''),
    },
  ];

  const section = (key: string, heading: string, rows: DurationRow[], nameHeader: string, countHeader: string) => (
    rows.length > 0 && (
      <div key={key}>
        <h2 className="text-base font-semibold text-neutral-800 mb-2">{heading}</h2>
        <SortableReportTable rows={rows} columns={durationColumns(nameHeader, countHeader)} rowKey={(r) => r.name} initialSort={{key: 'avg', dir: 'desc'}} xlsxTitle={heading}/>
      </div>
    )
  );

  const slowestKitchen = stations.byKitchen[0];
  const kpis: ReportKpi[] = [
    {label: t('kitchenTiming.ticketAvg'), value: `${fmtMin(ticketAvg)} min`, rawValue: Math.round(minutes(ticketAvg) * 10) / 10, rawFormat: 'number', hint: t('kitchenTiming.ticketsTimed', {count: ticketsTimed})},
    {label: t('kitchenTiming.prepAvg'), value: `${fmtMin(prepAvg)} min`, rawValue: Math.round(minutes(prepAvg) * 10) / 10, rawFormat: 'number', hint: t('kitchenTiming.itemsTimed', {count: stations.itemCount})},
    {label: t('kitchenTiming.slowestKitchen'), value: slowestKitchen?.name ?? '—', hint: slowestKitchen ? `${fmtMin(slowestKitchen.avgSeconds)} min` : undefined},
    {label: t('kitchenTiming.hours'), value: hoursLabel},
  ];

  return (
    <ReportsLayout title={title} subtitle={subtitle} onRefresh={fetchData}>
      <p className="text-sm text-neutral-600 mb-4" data-xlsx-ignore>{t('kitchenTiming.explanation')}</p>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      {section('types', t('kitchenTiming.byOrderType'), byOrderType, t('salesSummary.orderType'), t('columns.orders'))}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
        {section('kitchens', t('kitchenTiming.byKitchen'), stations.byKitchen, t('columns.kitchen'), t('kitchenTiming.items'))}
        {section('stages', t('kitchenTiming.byStage'), stations.byStage, t('kitchenTiming.stage'), t('kitchenTiming.items'))}
      </div>
      {section('categories', t('kitchenTiming.byCategory'), stations.byCategory, t('columns.category'), t('kitchenTiming.items'))}
    </ReportsLayout>
  );
};
