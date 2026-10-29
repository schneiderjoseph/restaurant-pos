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
import {cn, formatNumber, withDualCurrency} from "@/lib/utils.ts";

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
  const colCount = hasPaymentFilter ? 7 : 6;

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

      <div className="overflow-x-auto rounded-lg border border-neutral-200 mb-5">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <th className="py-3.5 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">{t('columns.customer')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.orders')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.netSales')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.total')}</th>
              <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('labels.cashPayments')}</th>
              <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">{t('columns.otherPayments')}</th>
              {hasPaymentFilter && (
                <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">{t('columns.filteredPayments')}</th>
              )}
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
                  {hasPaymentFilter && (
                    <td className="py-3 pr-6 pl-3 text-right text-sm">{withDualCurrency(row.filteredPayments)}</td>
                  )}
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={colCount} className="py-6 text-center text-sm text-neutral-500">{t('empty.noSalesData')}</td>
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
                {hasPaymentFilter && (
                  <td className="py-3 pr-6 pl-3 text-right text-sm">{withDualCurrency(totals.filteredPayments)}</td>
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

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
