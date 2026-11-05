import {useEffect, useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {parseDateRangeFromParams, parseMultiFilter} from "@/api/reports/shared/filters.ts";
import {
  aggregateSalesByCustomer,
  ANONYMOUS_CUSTOMER_ROW,
  CUSTOMER_SALES_FETCHES,
  excludeHouseSettlementOrders,
  fetchPaidOrders,
  paymentAmountForTypes,
  type CustomerSales,
} from "@/api/reports/sales";
import { Button } from "@/components/common/input/button.tsx";
import { chooseTempBillCurrency } from "@/components/common/currency/choose-temp-bill-currency.tsx";
import type { Order } from "@/api/model/order.ts";
import { customerHistoryIds, loadCustomerName } from "@/lib/customer.service.ts";
import type { PayCurrencyCode } from "@/lib/currency.ts";
import { getInvoiceNumber, getOrderSettlementFigures } from "@/lib/order.ts";
import {
  buildStayFolioBillHtml,
  getCustomerSalesBillLabels,
  openStayBillPrintWindow,
  writeAndPrintStayBillWindow,
  type StayBillLang,
} from "@/lib/stay-folio-bill.ts";
import {
  getCachedRestaurantLogoDataUrl,
  getCachedRestaurantProfile,
} from "@/lib/restaurant-profile.ts";
import { toLuxonDateTime } from "@/lib/datetime.ts";
import {cn, formatNumber, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {ReportInsights, type ReportInsight} from "@/components/reports/report-insights.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {REPORTS_SALES_BY_CUSTOMER} from "@/routes/posr.ts";

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    ...parseDateRangeFromParams(params),
    customerId: params.get("customer_id") || "",
    paymentTypeIds: parseMultiFilter(params, "payment_types"),
  };
};

/** Paid sales per customer; guests who gave no name add up on the first row. */
export const SalesByCustomerReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const [rows, setRows] = useState<CustomerSales[]>([]);
  const [detailOrders, setDetailOrders] = useState<Order[]>([]);
  const [guestName, setGuestName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const filters = useMemo(parseFilters, []);
  const singleCustomer = Boolean(filters.customerId);
  const hasPaymentFilter = filters.paymentTypeIds.length > 0;

  const subtitle = useMemo(() => {
    const bits = [
      filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : null,
      singleCustomer ? (guestName || filters.customerId) : null,
      hasPaymentFilter ? t('labels.paymentFilterActive', { count: filters.paymentTypeIds.length }) : null,
    ].filter(Boolean);
    return bits.length ? bits.join(" · ") : undefined;
  }, [filters, guestName, hasPaymentFilter, singleCustomer, t]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        let customerIds: string[] | undefined;
        let customerName = "";
        if (filters.customerId) {
          const [history, name] = await Promise.all([
            customerHistoryIds(db, filters.customerId),
            loadCustomerName(db, filters.customerId),
          ]);
          customerIds = history.map(String);
          customerName = name;
        }

        const raw = await fetchPaidOrders(db, {
          startDate: filters.startDate,
          endDate: filters.endDate,
          fetches: CUSTOMER_SALES_FETCHES,
          customerIds,
          paymentTypeIds: filters.paymentTypeIds,
        });
        const orders = excludeHouseSettlementOrders(raw);
        setDetailOrders(singleCustomer ? orders : []);
        setGuestName(singleCustomer ? customerName || filters.customerId : "");
        setRows(aggregateSalesByCustomer(orders, { paymentTypeIds: filters.paymentTypeIds }));
      } catch (err) {
        console.error("Failed to load sales by customer report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [db, filters.startDate, filters.endDate, filters.customerId, filters.paymentTypeIds, singleCustomer, t]);

  const totals = useMemo(() => rows.reduce(
    (sum, row) => ({
      orders: sum.orders + row.orders,
      netSales: sum.netSales + row.netSales,
      total: sum.total + row.total,
      cash: sum.cash + row.cash,
      otherPayments: sum.otherPayments + row.otherPayments,
      filteredPayments: sum.filteredPayments + row.filteredPayments,
    }),
    {orders: 0, netSales: 0, total: 0, cash: 0, otherPayments: 0, filteredPayments: 0},
  ), [rows]);

  const anonymous = rows.find((row) => row.customerId === ANONYMOUS_CUSTOMER_ROW);
  const anonymousShare = totals.total > 0 && anonymous ? (anonymous.total / totals.total) * 100 : 0;

  const printCustomerFolio = async (lang: StayBillLang) => {
    if (!singleCustomer) return;
    let printWindow: Window | null = null;
    const printCurrency = await chooseTempBillCurrency({
      documentKind: 'folio',
      onBeforeResolve: () => {
        printWindow = openStayBillPrintWindow();
      },
    });
    if (!printCurrency) return;
    if (!printWindow) {
      toast.error(t('errors.unableToLoad'));
      return;
    }
    setPrinting(true);
    try {
      const profile = getCachedRestaurantProfile();
      const contact = [profile.phone, profile.email].filter(Boolean).join(' · ');
      const locale = lang === 'en' ? 'en-US' : 'fr-HT';
      const labels = getCustomerSalesBillLabels(lang, { filtered: hasPaymentFilter });
      const periodTotal = detailOrders.reduce(
        (sum, order) => sum + getOrderSettlementFigures(order).grandTotalDue,
        0,
      );
      const filteredTotal = hasPaymentFilter
        ? detailOrders.reduce((sum, order) => sum + paymentAmountForTypes(order, filters.paymentTypeIds), 0)
        : periodTotal;
      const html = buildStayFolioBillHtml({
        guestName: guestName || filters.customerId,
        room: '—',
        dateIn: filters.startDate || '—',
        dateOut: filters.endDate || '—',
        restaurantName: profile.name || undefined,
        restaurantAddress: profile.address || undefined,
        restaurantContact: contact || undefined,
        restaurantLogoDataUrl: getCachedRestaurantLogoDataUrl(),
        orders: detailOrders,
        roomTotal: filteredTotal,
        settledAmount: 0,
        outstanding: 0,
        settlements: [],
        labels,
        printedAt: new Date().toLocaleString(locale),
        locale,
        printCurrency: printCurrency as PayCurrencyCode,
        showStaySummary: true,
        // A sales statement says nothing about what was collected: total only.
        showSettlementTotals: false,
        chargeAmountOf: (order) =>
          hasPaymentFilter
            ? paymentAmountForTypes(order, filters.paymentTypeIds)
            : getOrderSettlementFigures(order).grandTotalDue,
      });
      writeAndPrintStayBillWindow(printWindow, html);
    } catch (err) {
      console.error('Customer sales folio print failed', err);
      try {
        printWindow.close();
      } catch {
        // ignore
      }
      toast.error(t('errors.unableToLoad'));
    } finally {
      setPrinting(false);
    }
  };

  const title = t('reports.salesByCustomer');

  const named = rows.filter((row) => row.customerId !== ANONYMOUS_CUSTOMER_ROW);
  const pctOf = (part: number) => (totals.total > 0 ? Math.round((part / totals.total) * 100) : 0);
  const customerInsights: ReportInsight[] = [];
  if (!singleCustomer && named.length > 0) {
    const byTotal = [...named].sort((a, b) => b.total - a.total);
    customerInsights.push({id: 'top', severity: 'info', text: t('insights.customers.top', {name: byTotal[0].name ?? '—', amount: withCurrency(byTotal[0].total), pct: pctOf(byTotal[0].total), orders: byTotal[0].orders})});
    if (named.length >= 10) {
      const top10 = byTotal.slice(0, 10).reduce((sum, r) => sum + r.total, 0);
      customerInsights.push({id: 'top10', severity: 'info', text: t('insights.customers.top10', {pct: pctOf(top10), count: named.length})});
    }
    const regulars = named.filter((r) => r.orders >= 3);
    if (regulars.length) {
      customerInsights.push({id: 'regulars', severity: 'good', text: t('insights.customers.regulars', {count: regulars.length, amount: withCurrency(regulars.reduce((sum, r) => sum + r.total, 0))})});
    }
    const namedTotal = named.reduce((sum, r) => sum + r.total, 0);
    const namedOrders = named.reduce((sum, r) => sum + r.orders, 0);
    if (anonymous && anonymous.orders > 0 && namedOrders > 0) {
      customerInsights.push({id: 'avg-compare', severity: 'info', text: t('insights.customers.avgCompare', {named: withCurrency(namedTotal / namedOrders), anonymous: withCurrency(anonymous.total / anonymous.orders)})});
    }
  }
  if (!singleCustomer && anonymousShare >= 50) {
    customerInsights.push({id: 'anonymous', severity: 'warn', text: t('insights.customers.anonymous', {pct: Math.round(anonymousShare)})});
  }

  type Row = (typeof rows)[number];
  const sumOf = (rs: Row[], f: (r: Row) => number) => rs.reduce((acc, r) => acc + f(r), 0);
  const customerColumns: ReportColumn<Row>[] = [
    {
      key: 'customer',
      header: t('columns.customer'),
      sortValue: (r) => (r.customerId === ANONYMOUS_CUSTOMER_ROW ? '' : (r.name ?? '').toLowerCase()),
      searchValue: (r) => `${r.name ?? ''} ${r.room ?? ''}`,
      render: (r) => r.customerId === ANONYMOUS_CUSTOMER_ROW
        ? <span className="font-semibold">{t('labels.anonymousCustomer')}</span>
        : (
          <a href={`${REPORTS_SALES_BY_CUSTOMER}?customer_id=${encodeURIComponent(r.customerId)}${filters.startDate ? `&start=${encodeURIComponent(filters.startDate)}` : ''}${filters.endDate ? `&end=${encodeURIComponent(filters.endDate)}` : ''}`} className="text-primary-600 hover:underline">
            {r.name}{r.room && <span className="ml-2 text-neutral-500">#{r.room}</span>}
          </a>
        ),
      cellClass: (r) => cn(r.customerId === ANONYMOUS_CUSTOMER_ROW && 'bg-warning-50'),
      total: () => t('columns.total'),
    },
    {key: 'orders', header: t('columns.orders'), align: 'right', sortValue: (r) => r.orders, render: (r) => formatNumber(r.orders), total: (rs) => formatNumber(sumOf(rs, (r) => r.orders))},
    {key: 'net', header: t('columns.netSales'), align: 'right', sortValue: (r) => r.netSales, render: (r) => withCurrency(r.netSales), total: (rs) => withCurrency(sumOf(rs, (r) => r.netSales))},
    {key: 'total', header: t('columns.total'), align: 'right', sortValue: (r) => r.total, render: (r) => <span className="font-semibold">{withCurrency(r.total)}</span>, total: (rs) => withCurrency(sumOf(rs, (r) => r.total))},
    {key: 'avg', header: t('columns.avgCheck'), align: 'right', sortValue: (r) => (r.orders ? r.total / r.orders : 0), render: (r) => withCurrency(r.orders ? r.total / r.orders : 0)},
    {key: 'share', header: t('serverSales.share'), align: 'right', sortValue: (r) => r.total, render: (r) => `${pctOf(r.total)} %`},
    {key: 'cash', header: t('labels.cashPayments'), align: 'right', sortValue: (r) => r.cash, render: (r) => withCurrency(r.cash), total: (rs) => withCurrency(sumOf(rs, (r) => r.cash))},
    {key: 'other', header: t('columns.otherPayments'), align: 'right', sortValue: (r) => r.otherPayments, render: (r) => withCurrency(r.otherPayments), total: (rs) => withCurrency(sumOf(rs, (r) => r.otherPayments))},
    ...(hasPaymentFilter ? [{key: 'filtered', header: t('columns.filteredPayments'), align: 'right' as const, sortValue: (r: Row) => r.filteredPayments, render: (r: Row) => withCurrency(r.filteredPayments), total: (rs: Row[]) => withCurrency(sumOf(rs, (r) => r.filteredPayments))}] : []),
  ];

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }

  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  const printActions = singleCustomer ? (
    <div className="flex gap-2">
      <Button variant="primary" size="lg" disabled={printing} onClick={() => void printCustomerFolio('fr')}>
        {t('actions.printFr')}
      </Button>
      <Button variant="primary" size="lg" disabled={printing} onClick={() => void printCustomerFolio('en')}>
        {t('actions.printEn')}
      </Button>
    </div>
  ) : undefined;

  return (
    <ReportsLayout title={title} subtitle={subtitle} customActions={printActions}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        {!singleCustomer && (
          <>
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
          </>
        )}
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('columns.total')}</div>
          <div className="text-2xl font-semibold">{withDualCurrency(totals.total)}</div>
          <div className="text-sm text-neutral-500">{formatNumber(totals.orders)} {t('columns.orders').toLowerCase()}</div>
        </div>
        {hasPaymentFilter && (
          <div className="border rounded-lg p-4 bg-neutral-50">
            <div className="text-sm text-neutral-500">{t('columns.filteredPayments')}</div>
            <div className="text-2xl font-semibold">{withDualCurrency(totals.filteredPayments)}</div>
          </div>
        )}
      </div>

      <ReportInsights items={customerInsights} />
      {!singleCustomer ? (
        <SortableReportTable
          rows={rows}
          columns={customerColumns}
          rowKey={(r) => r.customerId}
          initialSort={{key: 'total', dir: 'desc'}}
          searchPlaceholder={t('credit.searchCustomer')}
          emptyText={t('empty.noSalesData')}
          rowTestId="sales-by-customer-row"
          xlsxTitle={title}
        />
      ) : (
        <SortableReportTable
          rows={rows}
          columns={customerColumns.filter((c) => c.key !== 'share')}
          rowKey={(r) => r.customerId}
          rowTestId="sales-by-customer-row"
          xlsxTitle={title}
        />
      )}

      {singleCustomer && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th className="py-3.5 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">{t('columns.order')}</th>
                <th className="py-3.5 px-3 text-left text-sm font-semibold text-neutral-700">{t('columns.createdAt')}</th>
                <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.total')}</th>
                {hasPaymentFilter && (
                  <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">{t('columns.filteredPayments')}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {detailOrders.length === 0 ? (
                <tr>
                  <td colSpan={hasPaymentFilter ? 4 : 3} className="py-6 text-center text-sm text-neutral-500">
                    {t('empty.noSalesData')}
                  </td>
                </tr>
              ) : detailOrders.map((order) => (
                <tr key={String(order.id)} data-testid="sales-by-customer-order">
                  <td className="py-3 pl-6 pr-3 text-sm text-neutral-800">#{getInvoiceNumber(order)}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700">
                    {toLuxonDateTime(order.created_at as never).toFormat('yyyy-LL-dd HH:mm')}
                  </td>
                  <td className="py-3 px-3 text-right text-sm">
                    {withDualCurrency(getOrderSettlementFigures(order).grandTotalDue)}
                  </td>
                  {hasPaymentFilter && (
                    <td className="py-3 pr-6 pl-3 text-right text-sm">
                      {withDualCurrency(paymentAmountForTypes(order, filters.paymentTypeIds))}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportsLayout>
  );
};
