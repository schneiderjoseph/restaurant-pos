import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ReportsLayout} from '@/screens/partials/reports.layout.tsx';
import {useDB} from '@/api/db/db.ts';
import {parseDateRangeFromParams} from '@/api/reports/shared/filters.ts';
import {getRoomChargeReport, type RoomChargeReport, type RoomChargeRow} from '@/api/reports/sales/room-charges.ts';
import {buildRoomChargeInsights, groupRoomChargesByGuest, type RoomGuestTotal} from '@/api/reports/insights/rooms.ts';
import {toLuxonDateTime} from '@/lib/datetime.ts';
import {formatNumber, withCurrency, withDualCurrency} from '@/lib/utils.ts';
import {ReportKpis, type ReportKpi} from '@/components/reports/report-kpis.tsx';
import {ReportInsights} from '@/components/reports/report-insights.tsx';
import {SortableReportTable, type ReportColumn} from '@/components/reports/sortable-report-table.tsx';

const parseFilters = () => parseDateRangeFromParams(new URLSearchParams(window.location.search));
const fmtDateTime = (d: Date | null) => (d ? toLuxonDateTime(d as never).toFormat('yyyy-LL-dd HH:mm') : '—');
const sumOf = <R,>(rs: R[], f: (r: R) => number) => rs.reduce((acc, r) => acc + f(r), 0);

/** Everything put on hotel guests' rooms over the period, by guest and order. */
export const RoomChargesReport = () => {
  const {t} = useTranslation('reports');
  const db = useDB();
  const filters = useMemo(parseFilters, []);
  const [report, setReport] = useState<RoomChargeReport>({rows: [], periodSales: 0});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} → ${filters.endDate}` : undefined;
  const title = t('reports.roomCharges');

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setReport(await getRoomChargeReport(db, filters));
    } catch (err) {
      console.error('Failed to load room charges', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, filters, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const {rows, periodSales} = report;
  const guests = useMemo(() => groupRoomChargesByGuest(rows), [rows]);
  const insights = useMemo(
    () => buildRoomChargeInsights(rows, periodSales, (k, p) => String(t(k, p as never)), withCurrency),
    [rows, periodSales, t],
  );

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', {error})}</div></ReportsLayout>;
  }

  const sourceBadge = (source: 'asi' | 'manual') => (
    <span className={`text-xs rounded px-1.5 py-0.5 ${source === 'asi' ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}`}>
      {source === 'asi' ? t('roomCharges.sourceAsi') : t('roomCharges.sourceManual')}
    </span>
  );
  const statusOf = (g: {inHouse: boolean; unsettled: boolean}) =>
    g.unsettled ? t('roomCharges.unsettled') : g.inHouse ? t('roomCharges.inHouse') : t('roomCharges.departed');
  const statusClass = (g: {inHouse: boolean; unsettled: boolean}) =>
    g.unsettled ? 'text-red-700 font-semibold' : g.inHouse ? 'text-emerald-700' : 'text-neutral-500';

  const guestColumns: ReportColumn<RoomGuestTotal>[] = [
    {key: 'room', header: t('roomCharges.room'), sortValue: (g) => Number(g.room) || g.room, searchValue: (g) => g.room, render: (g) => <span className="font-semibold">{g.room || '—'}</span>, total: () => t('columns.total')},
    {key: 'guest', header: t('roomCharges.guest'), sortValue: (g) => g.guestName.toLowerCase(), searchValue: (g) => `${g.guestName} ${g.folio}`, render: (g) => g.guestName || '—'},
    {key: 'folio', header: t('roomCharges.folio'), searchValue: (g) => g.folio, render: (g) => g.folio || '—'},
    {key: 'source', header: t('roomCharges.source'), sortValue: (g) => g.source, render: (g) => sourceBadge(g.source)},
    {key: 'status', header: t('roomCharges.status'), sortValue: statusOf, searchValue: statusOf, render: statusOf, cellClass: statusClass},
    {key: 'count', header: t('columns.orders'), align: 'right', sortValue: (g) => g.count, render: (g) => formatNumber(g.count), total: (gs) => formatNumber(sumOf(gs, (g) => g.count))},
    {key: 'amount', header: t('roomCharges.charged'), align: 'right', sortValue: (g) => g.amount, render: (g) => <span className="font-semibold">{withCurrency(g.amount)}</span>, total: (gs) => withCurrency(sumOf(gs, (g) => g.amount))},
    {key: 'last', header: t('roomCharges.lastCharge'), sortValue: (g) => g.lastAt?.getTime() ?? 0, render: (g) => fmtDateTime(g.lastAt)},
  ];

  const detailColumns: ReportColumn<RoomChargeRow>[] = [
    {key: 'order', header: t('columns.order'), sortValue: (r) => r.invoiceNumber ?? 0, searchValue: (r) => String(r.invoiceNumber ?? r.orderId), render: (r) => (r.invoiceNumber ? `#${r.invoiceNumber}` : r.orderId), total: () => t('columns.total')},
    {key: 'at', header: t('columns.date'), sortValue: (r) => r.createdAt?.getTime() ?? 0, render: (r) => fmtDateTime(r.createdAt)},
    {key: 'room', header: t('roomCharges.room'), sortValue: (r) => Number(r.room) || r.room, searchValue: (r) => r.room, render: (r) => r.room || '—'},
    {key: 'guest', header: t('roomCharges.guest'), sortValue: (r) => r.guestName.toLowerCase(), searchValue: (r) => `${r.guestName} ${r.folio}`, render: (r) => r.guestName || '—'},
    {key: 'folio', header: t('roomCharges.folio'), render: (r) => r.folio || '—', cellClass: (r) => (r.source === 'asi' && !r.folio ? 'text-amber-700 font-semibold' : '')},
    {key: 'source', header: t('roomCharges.source'), sortValue: (r) => r.source, render: (r) => sourceBadge(r.source)},
    {key: 'amount', header: t('roomCharges.charged'), align: 'right', sortValue: (r) => r.roomAmount, render: (r) => <span className="font-semibold">{withCurrency(r.roomAmount)}</span>, total: (rs) => withCurrency(sumOf(rs, (r) => r.roomAmount))},
    {key: 'total', header: t('roomCharges.orderTotal'), align: 'right', sortValue: (r) => r.orderTotal, render: (r) => withCurrency(r.orderTotal), total: (rs) => withCurrency(sumOf(rs, (r) => r.orderTotal))},
    {key: 'cashier', header: t('metrics.cashier'), sortValue: (r) => r.cashierName, searchValue: (r) => r.cashierName, render: (r) => r.cashierName || '—'},
  ];

  const total = sumOf(rows, (r) => r.roomAmount);
  const share = periodSales > 0 ? Math.round((total / periodSales) * 1000) / 10 : 0;
  const asiTotal = sumOf(rows.filter((r) => r.source === 'asi'), (r) => r.roomAmount);
  const unsettled = guests.filter((g) => g.unsettled);
  const kpis: ReportKpi[] = [
    {label: t('roomCharges.totalCharged'), value: withDualCurrency(total), rawValue: total, hint: t('roomCharges.shareOfSales', {pct: share})},
    {label: t('columns.orders'), value: formatNumber(rows.length), rawValue: rows.length, rawFormat: 'integer', hint: rows.length > 0 ? t('roomCharges.average', {amount: withCurrency(total / rows.length)}) : undefined},
    {label: t('roomCharges.guests'), value: formatNumber(guests.length), rawValue: guests.length, rawFormat: 'integer', hint: t('roomCharges.asiManual', {asi: withCurrency(asiTotal), manual: withCurrency(total - asiTotal)})},
    {
      label: t('roomCharges.unsettledKpi'),
      value: withCurrency(sumOf(unsettled, (g) => g.amount)),
      rawValue: sumOf(unsettled, (g) => g.amount),
      tone: unsettled.length ? 'bad' : 'good',
      hint: t('roomCharges.unsettledHint', {count: unsettled.length}),
    },
  ];

  return (
    <ReportsLayout title={title} subtitle={subtitle} onRefresh={fetchData}>
      <p className="text-sm text-neutral-600 mb-4" data-xlsx-ignore>{t('roomCharges.explanation')}</p>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('roomCharges.byGuest')}</h2>
      <SortableReportTable
        rows={guests}
        columns={guestColumns}
        rowKey={(g) => g.key}
        initialSort={{key: 'amount', dir: 'desc'}}
        searchPlaceholder={t('roomCharges.search')}
        emptyText={t('insights.rooms.none')}
        xlsxTitle={t('roomCharges.byGuest')}
      />
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('roomCharges.detail')}</h2>
      <SortableReportTable
        rows={rows}
        columns={detailColumns}
        rowKey={(r) => r.orderId}
        initialSort={{key: 'at', dir: 'desc'}}
        searchPlaceholder={t('roomCharges.search')}
        emptyText={t('insights.rooms.none')}
        xlsxTitle={t('roomCharges.detail')}
      />
      <p className="text-xs text-neutral-500" data-xlsx-ignore>{t('roomCharges.note')}</p>
    </ReportsLayout>
  );
};
