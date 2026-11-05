import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import { fetchPaidOrders, getOrderFigures } from '@/api/reports/sales';
import { parseDateRangeFromParams } from '@/api/reports/shared/filters.ts';
import { formatTableLabel } from '@/lib/table-label.ts';
import { formatNumber, withCurrency, withDualCurrency } from '@/lib/utils.ts';
import { ReportKpis, type ReportKpi } from '@/components/reports/report-kpis.tsx';
import { ReportInsights, type ReportInsight } from '@/components/reports/report-insights.tsx';
import { SortableReportTable, type ReportColumn } from '@/components/reports/sortable-report-table.tsx';

type TableSummaryRow = {
  table: string;
  orders: number;
  covers: number;
  revenue: number;
  avgCheck: number;
  hasTable: boolean;
};

const parseFilters = () => parseDateRangeFromParams(new URLSearchParams(window.location.search));

export const TablesSummaryReport = () => {
  const { t, i18n } = useTranslation('reports');
  const db = useDB();
  const [rows, setRows] = useState<TableSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(parseFilters, []);
  const subtitle =
    filters.startDate && filters.endDate
      ? `${filters.startDate} → ${filters.endDate}`
      : undefined;

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const orders = await fetchPaidOrders(db, {
        startDate: filters.startDate,
        endDate: filters.endDate,
        fetches: [
          'table',
          'floor',
          'order_type',
          'payments',
          'payments.payment_type',
          'tax',
          'discount',
          'items',
          'items.taxes',
          'items.tax_mode',
          'order_taxes',
          'order_taxes.tax',
          'order_discounts',
          'order_discounts.discount',
          'coupon',
          'coupon.coupon',
          'extras',
        ],
      });

      const map = new Map<string, { orders: number; covers: number; revenue: number; hasTable: boolean }>();
      orders.forEach((order) => {
        const figures = getOrderFigures(order);
        // No table: grouped by its order type (takeaway, delivery…), not all as delivery.
        const table = order?.table
          ? formatTableLabel(order.table, i18n.language)
          : order?.order_type?.name || t('columns.noTable');
        const current = map.get(table) || { orders: 0, covers: 0, revenue: 0, hasTable: Boolean(order?.table) };
        current.orders += 1;
        current.covers += Number(order?.covers) || 0;
        current.revenue += figures.totalRevenue;
        map.set(table, current);
      });

      setRows(
        Array.from(map.entries())
          .map(([table, data]) => ({
            table,
            orders: data.orders,
            covers: data.covers,
            revenue: data.revenue,
            hasTable: data.hasTable,
            avgCheck: data.orders > 0 ? data.revenue / data.orders : 0,
          }))
          .sort((a, b) => b.revenue - a.revenue),
      );
    } catch (err) {
      console.error('Failed to load tables summary report', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [filters.startDate, filters.endDate]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => {
          acc.orders += row.orders;
          acc.covers += row.covers;
          acc.revenue += row.revenue;
          return acc;
        },
        { orders: 0, covers: 0, revenue: 0 },
      ),
    [rows],
  );

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
  const teamAvg = totals.orders > 0 ? totals.revenue / totals.orders : 0;

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (rows.length === 0) return out;
    const seated = rows.filter((r) => r.hasTable);
    const best = seated[0] ?? rows[0];
    out.push({ id: 'best', severity: 'good', text: t('insights.tables.best', { table: best.table, amount: withCurrency(best.revenue), pct: pct(best.revenue, totals.revenue), orders: best.orders }) });
    if (seated.length >= 8) {
      const top5 = seated.slice(0, 5);
      out.push({ id: 'top5', severity: 'info', text: t('insights.tables.top5', { pct: pct(top5.reduce((sum, r) => sum + r.revenue, 0), totals.revenue), count: seated.length }) });
    }
    const noTable = rows.filter((r) => !r.hasTable);
    if (noTable.length) {
      const amount = noTable.reduce((sum, r) => sum + r.revenue, 0);
      out.push({ id: 'no-table', severity: 'info', text: t('insights.tables.noTable', { amount: withCurrency(amount), pct: pct(amount, totals.revenue), types: noTable.map((r) => r.table).join(', ') }) });
    }
    const quiet = seated.filter((r) => r.orders <= 2);
    if (quiet.length && seated.length >= 5) {
      out.push({ id: 'quiet', severity: 'info', text: t('insights.tables.quiet', { count: quiet.length, names: quiet.slice(0, 8).map((r) => r.table).join(', ') }) });
    }
    return out;
  }, [rows, totals.revenue, t]);

  if (loading) {
    return (
      <ReportsLayout title={t('titles.tablesSummary')} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('loading.report')}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={t('titles.tablesSummary')} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">
          {t('errors.failedToLoad', { error })}
        </div>
      </ReportsLayout>
    );
  }

  const sumOf = (rs: TableSummaryRow[], f: (r: TableSummaryRow) => number) => rs.reduce((acc, r) => acc + f(r), 0);
  const columns: ReportColumn<TableSummaryRow>[] = [
    { key: 'table', header: t('columns.table'), sortValue: (r) => r.table.toLowerCase(), searchValue: (r) => r.table, render: (r) => <span className="font-medium">{r.table}</span>, total: () => t('columns.total') },
    { key: 'orders', header: t('columns.orders'), align: 'right', sortValue: (r) => r.orders, render: (r) => formatNumber(r.orders, 0), total: (rs) => formatNumber(sumOf(rs, (r) => r.orders), 0) },
    { key: 'covers', header: t('columns.covers'), align: 'right', sortValue: (r) => r.covers, render: (r) => formatNumber(r.covers, 0), total: (rs) => formatNumber(sumOf(rs, (r) => r.covers), 0) },
    { key: 'revenue', header: t('columns.revenue'), align: 'right', sortValue: (r) => r.revenue, render: (r) => withCurrency(r.revenue), total: (rs) => withCurrency(sumOf(rs, (r) => r.revenue)) },
    { key: 'share', header: t('serverSales.share'), align: 'right', sortValue: (r) => r.revenue, render: (r) => `${pct(r.revenue, totals.revenue)} %` },
    {
      key: 'avg',
      header: t('columns.avgCheck'),
      align: 'right',
      sortValue: (r) => r.avgCheck,
      render: (r) => withCurrency(r.avgCheck),
      cellClass: (r) => (teamAvg > 0 && r.orders >= 3 && r.avgCheck < teamAvg * 0.6 ? 'text-amber-700' : ''),
      total: (rs) => {
        const o = sumOf(rs, (r) => r.orders);
        return withCurrency(o ? sumOf(rs, (r) => r.revenue) / o : 0);
      },
    },
  ];

  const tablesUsed = rows.filter((r) => r.hasTable).length;
  const kpis: ReportKpi[] = [
    { label: t('columns.revenue'), value: withDualCurrency(totals.revenue), rawValue: totals.revenue },
    { label: t('columns.orders'), value: formatNumber(totals.orders, 0), rawValue: totals.orders, rawFormat: 'integer', hint: t('tablesReport.covers', { count: totals.covers }) },
    { label: t('columns.avgCheck'), value: withCurrency(teamAvg), rawValue: teamAvg },
    { label: t('tablesReport.tablesUsed'), value: formatNumber(tablesUsed, 0), rawValue: tablesUsed, rawFormat: 'integer' },
  ];

  return (
    <ReportsLayout title={t('titles.tablesSummary')} subtitle={subtitle} onRefresh={fetchData}>
      <ReportKpis items={kpis} />
      <ReportInsights items={insights} />
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.table}
        initialSort={{ key: 'revenue', dir: 'desc' }}
        searchPlaceholder={t('tablesReport.search')}
        emptyText={t('empty.noTables')}
        xlsxTitle={t('titles.tablesSummary')}
      />
    </ReportsLayout>
  );
};
