import {useEffect, useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {parseDateRangeFromParams} from "@/api/reports/shared/filters.ts";
import {
  aggregateSalesByCustomer,
  ANONYMOUS_CUSTOMER_ROW,
  CUSTOMER_SALES_FETCHES,
  fetchPaidOrders,
  type CustomerSales,
} from "@/api/reports/sales";
import {cn, formatNumber, withDualCurrency} from "@/lib/utils.ts";

const parseFilters = () => parseDateRangeFromParams(new URLSearchParams(window.location.search));

/** Paid sales per customer; guests who gave no name add up on the first row. */
export const SalesByCustomerReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const [rows, setRows] = useState<CustomerSales[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(parseFilters, []);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : undefined;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);
        const orders = await fetchPaidOrders(db, {...filters, fetches: CUSTOMER_SALES_FETCHES});
        setRows(aggregateSalesByCustomer(orders));
      } catch (err) {
        console.error("Failed to load sales by customer report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [filters.startDate, filters.endDate]);

  const totals = useMemo(() => rows.reduce(
    (sum, row) => ({
      orders: sum.orders + row.orders,
      netSales: sum.netSales + row.netSales,
      total: sum.total + row.total,
      cash: sum.cash + row.cash,
      otherPayments: sum.otherPayments + row.otherPayments,
    }),
    {orders: 0, netSales: 0, total: 0, cash: 0, otherPayments: 0},
  ), [rows]);

  const anonymous = rows.find((row) => row.customerId === ANONYMOUS_CUSTOMER_ROW);
  const anonymousShare = totals.total > 0 && anonymous ? (anonymous.total / totals.total) * 100 : 0;

  const title = t('reports.salesByCustomer');

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }

  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  return (
    <ReportsLayout title={title} subtitle={subtitle}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('labels.anonymousCustomer')}</div>
          <div className="text-2xl font-semibold" data-testid="sales-by-customer-anonymous-total">
            {withDualCurrency(anonymous?.total ?? 0)}
          </div>
          <div className="text-sm text-neutral-500">
            {t('labels.anonymousOrders', {count: anonymous?.orders ?? 0, share: formatNumber(anonymousShare)})}
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('labels.namedCustomers')}</div>
          <div className="text-2xl font-semibold">{withDualCurrency(totals.total - (anonymous?.total ?? 0))}</div>
          <div className="text-sm text-neutral-500">
            {t('labels.customerCount', {count: rows.length - (anonymous ? 1 : 0)})}
          </div>
        </div>
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('columns.total')}</div>
          <div className="text-2xl font-semibold">{withDualCurrency(totals.total)}</div>
          <div className="text-sm text-neutral-500">{formatNumber(totals.orders)} {t('columns.orders').toLowerCase()}</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <th className="py-3.5 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">{t('columns.customer')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.orders')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.netSales')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.total')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('labels.cashPayments')}</th>
              <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">{t('columns.otherPayments')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {rows.length > 0 ? rows.map((row) => {
              const isAnonymous = row.customerId === ANONYMOUS_CUSTOMER_ROW;
              return (
                <tr key={row.customerId} className={cn(isAnonymous && "bg-warning-50")} data-testid="sales-by-customer-row">
                  <td className="py-3 pl-6 pr-3 text-sm text-neutral-800">
                    <span className={cn(isAnonymous && "font-semibold")}>
                      {isAnonymous ? t('labels.anonymousCustomer') : row.name}
                    </span>
                    {row.room && <span className="ml-2 text-neutral-500">#{row.room}</span>}
                  </td>
                  <td className="py-3 px-3 text-right text-sm">{formatNumber(row.orders)}</td>
                  <td className="py-3 px-3 text-right text-sm">{withDualCurrency(row.netSales)}</td>
                  <td className="py-3 px-3 text-right text-sm font-semibold">{withDualCurrency(row.total)}</td>
                  <td className="py-3 px-3 text-right text-sm">{withDualCurrency(row.cash)}</td>
                  <td className="py-3 pr-6 pl-3 text-right text-sm">{withDualCurrency(row.otherPayments)}</td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-neutral-500">{t('empty.noSalesData')}</td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-neutral-50 font-semibold">
              <tr>
                <td className="py-3 pl-6 pr-3 text-sm">{t('columns.total')}</td>
                <td className="py-3 px-3 text-right text-sm">{formatNumber(totals.orders)}</td>
                <td className="py-3 px-3 text-right text-sm">{withDualCurrency(totals.netSales)}</td>
                <td className="py-3 px-3 text-right text-sm">{withDualCurrency(totals.total)}</td>
                <td className="py-3 px-3 text-right text-sm">{withDualCurrency(totals.cash)}</td>
                <td className="py-3 pr-6 pl-3 text-right text-sm">{withDualCurrency(totals.otherPayments)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </ReportsLayout>
  );
};
