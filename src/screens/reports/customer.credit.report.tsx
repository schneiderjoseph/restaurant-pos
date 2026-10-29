import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import {
  aggregateCustomerCreditAr,
  type CustomerCreditArRow,
} from '@/api/reports/sales/customer-credit.ts';
import { Button } from '@/components/common/input/button.tsx';
import { chooseTempBillCurrency } from '@/components/common/currency/choose-temp-bill-currency.tsx';
import type { Order } from '@/api/model/order.ts';
import type { PayCurrencyCode } from '@/lib/currency.ts';
import {
  customerCreditFolioTotal,
  customerCreditOutstanding,
  loadCustomerCreditFolioOrders,
  loadCustomerCreditSettlements,
  loadCustomerCreditSettledTotal,
  orderCreditChargeTotal,
  type CreditSettlementRow,
} from '@/lib/credit.service.ts';
import {
  buildStayFolioBillHtml,
  getCreditBillLabels,
  openStayBillPrintWindow,
  writeAndPrintStayBillWindow,
  type StayBillLang,
} from '@/lib/stay-folio-bill.ts';
import {
  getCachedRestaurantLogoDataUrl,
  getCachedRestaurantProfile,
} from '@/lib/restaurant-profile.ts';
import { getInvoiceNumber } from '@/lib/order.ts';
import { loadCustomerName } from '@/lib/customer.service.ts';
import { cn, withDualCurrency } from '@/lib/utils.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { REPORTS_CUSTOMER_CREDIT } from '@/routes/posr.ts';

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    customerId: params.get('customer_id') || '',
    includeSettled: params.get('include_settled') === '1',
  };
};

/** House-credit AR snapshot: all debtors or one customer folio (+ print). */
export const CustomerCreditReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const filters = useMemo(parseFilters, []);
  const singleCustomer = Boolean(filters.customerId);

  const [rows, setRows] = useState<CustomerCreditArRow[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [settlements, setSettlements] = useState<CreditSettlementRow[]>([]);
  const [settledAmt, setSettledAmt] = useState(0);
  const [guestName, setGuestName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  const subtitle = singleCustomer
    ? (guestName || filters.customerId)
    : t('labels.creditArSnapshot');

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        if (singleCustomer) {
          const [folio, settlementRows, settled, customerName] = await Promise.all([
            loadCustomerCreditFolioOrders(db, filters.customerId),
            loadCustomerCreditSettlements(db, filters.customerId),
            loadCustomerCreditSettledTotal(db, filters.customerId),
            loadCustomerName(db, filters.customerId),
          ]);
          const charged = customerCreditFolioTotal(folio);
          const due = customerCreditOutstanding(charged, settled);
          const name = customerName || filters.customerId;
          setGuestName(String(name));
          setOrders(folio);
          setSettlements(settlementRows);
          setSettledAmt(settled);
          setRows([
            {
              customerId: filters.customerId,
              name: String(name),
              charged,
              settled,
              due,
            },
          ]);
        } else {
          const list = await aggregateCustomerCreditAr(db, {
            includeSettled: filters.includeSettled,
          });
          setRows(list);
          setOrders([]);
          setSettlements([]);
          setSettledAmt(0);
          setGuestName('');
        }
      } catch (err) {
        console.error('Failed to load customer credit report', err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [db, filters.customerId, filters.includeSettled, singleCustomer, t]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          charged: sum.charged + row.charged,
          settled: sum.settled + row.settled,
          due: sum.due + row.due,
        }),
        { charged: 0, settled: 0, due: 0 },
      ),
    [rows],
  );

  const printCreditFolio = async (lang: StayBillLang) => {
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
      const charged = customerCreditFolioTotal(orders);
      const due = customerCreditOutstanding(charged, settledAmt);
      const html = buildStayFolioBillHtml({
        guestName: guestName || filters.customerId,
        room: '—',
        dateIn: '—',
        dateOut: '—',
        restaurantName: profile.name || undefined,
        restaurantAddress: profile.address || undefined,
        restaurantContact: contact || undefined,
        restaurantLogoDataUrl: getCachedRestaurantLogoDataUrl(),
        orders,
        roomTotal: charged,
        settledAmount: settledAmt,
        outstanding: due,
        settlements: settlements.map((row) => ({
          amount: Number(row.amount) || 0,
          label: row.payment_type?.name,
          comments: row.comments,
          at: row.created_at != null
            ? new Date(String(row.created_at)).toLocaleString(locale)
            : undefined,
        })),
        labels: getCreditBillLabels(lang),
        printedAt: new Date().toLocaleString(locale),
        locale,
        printCurrency: printCurrency as PayCurrencyCode,
        chargeAmountOf: orderCreditChargeTotal,
      });
      writeAndPrintStayBillWindow(printWindow, html);
    } catch (err) {
      console.error('Credit folio print failed', err);
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

  const title = t('reports.customerCredit');

  if (loading) {
    return (
      <ReportsLayout title={title} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('loading.report')}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={title} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div>
      </ReportsLayout>
    );
  }

  const printActions = singleCustomer ? (
    <div className="flex gap-2">
      <Button
        variant="primary"
        size="lg"
        disabled={printing}
        onClick={() => void printCreditFolio('fr')}
        data-testid="credit-report-print-fr"
      >
        {t('actions.printFr')}
      </Button>
      <Button
        variant="primary"
        size="lg"
        disabled={printing}
        onClick={() => void printCreditFolio('en')}
        data-testid="credit-report-print-en"
      >
        {t('actions.printEn')}
      </Button>
    </div>
  ) : undefined;

  return (
    <ReportsLayout title={title} subtitle={subtitle} customActions={printActions}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('columns.creditCharged')}</div>
          <div className="text-2xl font-semibold">{withDualCurrency(totals.charged)}</div>
        </div>
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('columns.creditSettled')}</div>
          <div className="text-2xl font-semibold">{withDualCurrency(totals.settled)}</div>
        </div>
        <div className="border rounded-lg p-4 bg-neutral-50">
          <div className="text-sm text-neutral-500">{t('columns.creditDue')}</div>
          <div className="text-2xl font-semibold">{withDualCurrency(totals.due)}</div>
          <div className="text-sm text-neutral-500">
            {t('labels.customerCount', { count: rows.length })}
          </div>
        </div>
      </div>

      {!singleCustomer && (
        <div className="overflow-x-auto rounded-lg border border-neutral-200 mb-5">
          <table className="min-w-full divide-y divide-neutral-200">
            <thead className="bg-neutral-50">
              <tr>
                <th className="py-3.5 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">
                  {t('columns.customer')}
                </th>
                <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">
                  {t('columns.creditCharged')}
                </th>
                <th className="py-3.5 px-3 text-right text-sm font-semibold text-neutral-700">
                  {t('columns.creditSettled')}
                </th>
                <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">
                  {t('columns.creditDue')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-6 text-center text-sm text-neutral-500">
                    {t('empty.noCreditBalances')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.customerId} data-testid="credit-ar-row">
                    <td className="py-3 pl-6 pr-3 text-sm text-neutral-800">
                      <a
                        href={`${REPORTS_CUSTOMER_CREDIT}?customer_id=${encodeURIComponent(row.customerId)}`}
                        className="text-primary-600 hover:underline"
                        data-testid="credit-ar-customer-link"
                      >
                        {row.name}
                      </a>
                    </td>
                    <td className="py-3 px-3 text-right text-sm">{withDualCurrency(row.charged)}</td>
                    <td className="py-3 px-3 text-right text-sm">{withDualCurrency(row.settled)}</td>
                    <td className={cn(
                      'py-3 pr-6 pl-3 text-right text-sm',
                      row.due > 0.009 && 'font-semibold',
                    )}>
                      {withDualCurrency(row.due)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {singleCustomer && (
        <>
          <div className="overflow-x-auto rounded-lg border border-neutral-200 mb-5">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="py-3.5 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">
                    {t('columns.order')}
                  </th>
                  <th className="py-3.5 px-3 text-left text-sm font-semibold text-neutral-700">
                    {t('columns.createdAt')}
                  </th>
                  <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">
                    {t('columns.creditCharged')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-neutral-500">
                      {t('empty.noCreditCharges')}
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => (
                    <tr key={String(order.id)} data-testid="credit-folio-order">
                      <td className="py-3 pl-6 pr-3 text-sm text-neutral-800">
                        #{getInvoiceNumber(order)}
                      </td>
                      <td className="py-3 px-3 text-sm text-neutral-700">
                        {toLuxonDateTime(order.created_at as never).toFormat('yyyy-LL-dd HH:mm')}
                      </td>
                      <td className="py-3 pr-6 pl-3 text-right text-sm">
                        {withDualCurrency(orderCreditChargeTotal(order))}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 className="text-sm font-semibold text-neutral-700 mb-2">
            {t('labels.creditSettlements')}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-neutral-200">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="py-3.5 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">
                    {t('columns.createdAt')}
                  </th>
                  <th className="py-3.5 px-3 text-left text-sm font-semibold text-neutral-700">
                    {t('filters.paymentType')}
                  </th>
                  <th className="py-3.5 pr-6 pl-3 text-right text-sm font-semibold text-neutral-700">
                    {t('columns.creditSettled')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {settlements.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-sm text-neutral-500">
                      {t('empty.noCreditSettlements')}
                    </td>
                  </tr>
                ) : (
                  settlements.map((row, index) => (
                    <tr key={String(row.id ?? index)} data-testid="credit-settlement-row">
                      <td className="py-3 pl-6 pr-3 text-sm text-neutral-800">
                        {row.created_at != null
                          ? toLuxonDateTime(row.created_at as never).toFormat('yyyy-LL-dd HH:mm')
                          : '—'}
                      </td>
                      <td className="py-3 px-3 text-sm text-neutral-700">
                        {row.payment_type?.name || '—'}
                      </td>
                      <td className="py-3 pr-6 pl-3 text-right text-sm">
                        {withDualCurrency(Number(row.amount) || 0)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-sm text-neutral-500">
            {t('labels.creditOrdersCount', { count: orders.length })}
          </div>
        </>
      )}
    </ReportsLayout>
  );
};
