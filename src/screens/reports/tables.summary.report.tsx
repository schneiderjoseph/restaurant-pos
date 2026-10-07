import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import { fetchPaidOrders, getOrderFigures } from '@/api/reports/sales';
import { parseDateRangeFromParams } from '@/api/reports/shared/filters.ts';
import { formatTableLabel } from '@/lib/table-label.ts';
import { formatNumber, withDualCurrency } from '@/lib/utils.ts';

type TableSummaryRow = {
  table: string;
  orders: number;
  revenue: number;
  avgCheck: number;
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
      ? `${filters.startDate} to ${filters.endDate}`
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

      const map = new Map<string, { orders: number; revenue: number }>();
      orders.forEach((order) => {
        const figures = getOrderFigures(order);
        // No table: grouped by its order type (takeaway, delivery…), not all as delivery.
        const table = order?.table
          ? formatTableLabel(order.table, i18n.language)
          : order?.order_type?.name || t('columns.noTable');
        const current = map.get(table) || { orders: 0, revenue: 0 };
        current.orders += 1;
        current.revenue += figures.totalRevenue;
        map.set(table, current);
      });

      setRows(
        Array.from(map.entries())
          .map(([table, data]) => ({
            table,
            orders: data.orders,
            revenue: data.revenue,
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
          acc.revenue += row.revenue;
          return acc;
        },
        { orders: 0, revenue: 0 },
      ),
    [rows],
  );

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

  return (
    <ReportsLayout title={t('titles.tablesSummary')} subtitle={subtitle} onRefresh={fetchData}>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <th className="py-3 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">#</th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('columns.table')}
              </th>
              <th className="py-3 px-3 text-right text-sm font-semibold text-neutral-700">
                {t('columns.orders')}
              </th>
              <th className="py-3 px-3 text-right text-sm font-semibold text-neutral-700">
                {t('columns.revenue')}
              </th>
              <th className="py-3 pr-6 text-right text-sm font-semibold text-neutral-700">
                {t('columns.avgCheck')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-neutral-500">
                  {t('empty.noTables')}
                </td>
              </tr>
            ) : (
              <>
                {rows.map((row, index) => (
                  <tr key={row.table}>
                    <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">{index + 1}</td>
                    <td className="py-3 px-3 text-sm text-neutral-900">{row.table}</td>
                    <td className="py-3 px-3 text-sm text-neutral-700 text-right">
                      {formatNumber(row.orders, 0)}
                    </td>
                    <td className="py-3 px-3 text-sm text-neutral-900 text-right">
                      {withDualCurrency(row.revenue)}
                    </td>
                    <td className="py-3 pr-6 text-sm text-neutral-900 text-right">
                      {withDualCurrency(row.avgCheck)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-neutral-50 font-semibold">
                  <td className="py-3 pl-6 pr-3 text-sm" colSpan={2}>
                    {t('columns.total')}
                  </td>
                  <td className="py-3 px-3 text-sm text-right">{formatNumber(totals.orders, 0)}</td>
                  <td className="py-3 px-3 text-sm text-right">{withDualCurrency(totals.revenue)}</td>
                  <td className="py-3 pr-6 text-sm text-right">
                    {withDualCurrency(totals.orders > 0 ? totals.revenue / totals.orders : 0)}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </ReportsLayout>
  );
};
