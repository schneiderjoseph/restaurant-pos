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
import { cn, withCurrency, withDualCurrency } from '@/lib/utils.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { REPORTS_CUSTOMER_CREDIT } from '@/routes/posr.ts';
import { computeCreditAging } from '@/api/reports/sales/customer-credit.ts';
import { buildCreditInsights } from '@/api/reports/insights/credit.ts';
import { ReportKpis, type ReportKpi } from '@/components/reports/report-kpis.tsx';
import { ReportInsights } from '@/components/reports/report-insights.tsx';
import { SortableReportTable, type ReportColumn } from '@/components/reports/sortable-report-table.tsx';

const fmtDate = (d?: Date | null) =>
  d ? toLuxonDateTime(d as never).toFormat('yyyy-LL-dd') : '—';

const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

const sumBy = <R,>(rs: R[], f: (r: R) => number) => rs.reduce((acc, r) => acc + f(r), 0);

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
          current: sum.current + (row.aging?.current ?? 0),
          d31_60: sum.d31_60 + (row.aging?.d31_60 ?? 0),
          d61_90: sum.d61_90 + (row.aging?.d61_90 ?? 0),
          over90: sum.over90 + (row.aging?.over90 ?? 0),
          orders: sum.orders + (row.orderCount ?? 0),
        }),
        { charged: 0, settled: 0, due: 0, current: 0, d31_60: 0, d61_90: 0, over90: 0, orders: 0 },
      ),
    [rows],
  );

  /** Single-customer aging computed from the loaded folio. */
  const folioAging = useMemo(() => {
    if (!singleCustomer) return null;
    return computeCreditAging(
      orders.map((o) => ({
        at: o.created_at ? toLuxonDateTime(o.created_at as never).toJSDate() : null,
        amount: orderCreditChargeTotal(o),
      })),
      settledAmt,
      new Date(),
    );
  }, [orders, settledAmt, singleCustomer]);

  const aging = singleCustomer && folioAging
    ? folioAging
    : { current: totals.current, d31_60: totals.d31_60, d61_90: totals.d61_90, over90: totals.over90, oldestDueDays: null };
  const over60 = aging.d61_90 + aging.over90;

  const insights = useMemo(
    () => buildCreditInsights(
      singleCustomer && folioAging && rows[0] ? [{ ...rows[0], aging: folioAging }] : rows,
      (key, params) => String(t(key, params as never)),
      (n) => withCurrency(n),
    ),
    [rows, singleCustomer, folioAging, t],
  );

  const debtorCount = rows.filter((r) => r.due > 0.009).length;
  const kpis: ReportKpi[] = [
    {
      label: t('columns.creditDue'),
      value: withDualCurrency(totals.due),
      rawValue: totals.due,
      tone: aging.over90 > 0.009 ? 'bad' : over60 > 0.009 ? 'warn' : 'default',
      hint: singleCustomer ? undefined : t('labels.customerCount', { count: debtorCount }),
    },
    {
      label: t('credit.over60'),
      value: withDualCurrency(over60),
      rawValue: over60,
      tone: over60 > 0.009 ? 'warn' : 'good',
      hint: t('credit.pctOfDue', { pct: pctOf(over60, totals.due) }),
    },
    {
      label: t('columns.creditCharged'),
      value: withDualCurrency(totals.charged),
      rawValue: totals.charged,
      hint: t('labels.creditOrdersCount', { count: singleCustomer ? orders.length : totals.orders }),
    },
    {
      label: t('credit.collectionRate'),
      value: `${pctOf(totals.settled, totals.charged)} %`,
      rawValue: totals.charged > 0 ? totals.settled / totals.charged : 0,
      rawFormat: 'percent',
      tone: pctOf(totals.settled, totals.charged) >= 80 ? 'good' : 'default',
      hint: `${t('columns.creditSettled')} : ${withCurrency(totals.settled)}`,
    },
  ];

  const agingRows: Array<{ key: 'current' | 'd31_60' | 'd61_90' | 'over90'; label: string; amount: number; tone: string }> = [
    { key: 'current', label: t('credit.bucketCurrent'), amount: aging.current, tone: '' },
    { key: 'd31_60', label: t('credit.bucket31_60'), amount: aging.d31_60, tone: 'text-amber-700' },
    { key: 'd61_90', label: t('credit.bucket61_90'), amount: aging.d61_90, tone: 'text-orange-700' },
    { key: 'over90', label: t('credit.bucketOver90'), amount: aging.over90, tone: 'text-red-700 font-semibold' },
  ];
  const agingTotal = agingRows.reduce((sum, r) => sum + r.amount, 0);

  const debtorColumns: ReportColumn<CustomerCreditArRow>[] = [
    {
      key: 'name',
      header: t('columns.customer'),
      sortValue: (r) => r.name.toLowerCase(),
      searchValue: (r) => `${r.name} ${r.phone ?? ''}`,
      render: (r) => (
        <a
          href={`${REPORTS_CUSTOMER_CREDIT}?customer_id=${encodeURIComponent(r.customerId)}`}
          className="text-primary-600 hover:underline"
          data-testid="credit-ar-customer-link"
        >
          {r.name}
          {r.creditAllowed === false && (
            <span className="ml-2 text-xs rounded bg-neutral-200 px-1.5 py-0.5 text-neutral-700">{t('credit.revoked')}</span>
          )}
        </a>
      ),
      total: () => t('columns.total'),
    },
    { key: 'phone', header: t('credit.phone'), render: (r) => r.phone || '—', sortValue: (r) => r.phone ?? '' },
    { key: 'orders', header: t('columns.orders'), align: 'right', sortValue: (r) => r.orderCount ?? 0, render: (r) => r.orderCount ?? 0, total: (rs) => sumBy(rs, (r) => r.orderCount ?? 0) },
    { key: 'lastCharge', header: t('credit.lastCharge'), sortValue: (r) => r.lastChargeAt?.getTime() ?? 0, render: (r) => fmtDate(r.lastChargeAt) },
    { key: 'lastPayment', header: t('credit.lastPayment'), sortValue: (r) => r.lastSettlementAt?.getTime() ?? 0, render: (r) => fmtDate(r.lastSettlementAt) },
    { key: 'limit', header: t('credit.limit'), align: 'right', sortValue: (r) => r.creditLimit ?? 0, render: (r) => (r.creditLimit ? withCurrency(r.creditLimit) : '—') },
    { key: 'charged', header: t('columns.creditCharged'), align: 'right', sortValue: (r) => r.charged, render: (r) => withCurrency(r.charged), total: (rs) => withCurrency(sumBy(rs, (r) => r.charged)) },
    { key: 'settled', header: t('columns.creditSettled'), align: 'right', sortValue: (r) => r.settled, render: (r) => withCurrency(r.settled), total: (rs) => withCurrency(sumBy(rs, (r) => r.settled)) },
    { key: 'current', header: t('credit.bucketCurrentShort'), align: 'right', sortValue: (r) => r.aging?.current ?? 0, render: (r) => withCurrency(r.aging?.current ?? 0), total: (rs) => withCurrency(sumBy(rs, (r) => r.aging?.current ?? 0)) },
    { key: 'd31_60', header: '31–60', align: 'right', sortValue: (r) => r.aging?.d31_60 ?? 0, render: (r) => withCurrency(r.aging?.d31_60 ?? 0), cellClass: (r) => ((r.aging?.d31_60 ?? 0) > 0.009 ? 'text-amber-700' : ''), total: (rs) => withCurrency(sumBy(rs, (r) => r.aging?.d31_60 ?? 0)) },
    { key: 'd61_90', header: '61–90', align: 'right', sortValue: (r) => r.aging?.d61_90 ?? 0, render: (r) => withCurrency(r.aging?.d61_90 ?? 0), cellClass: (r) => ((r.aging?.d61_90 ?? 0) > 0.009 ? 'text-orange-700' : ''), total: (rs) => withCurrency(sumBy(rs, (r) => r.aging?.d61_90 ?? 0)) },
    { key: 'over90', header: '90+', align: 'right', sortValue: (r) => r.aging?.over90 ?? 0, render: (r) => withCurrency(r.aging?.over90 ?? 0), cellClass: (r) => ((r.aging?.over90 ?? 0) > 0.009 ? 'text-red-700 font-semibold' : ''), total: (rs) => withCurrency(sumBy(rs, (r) => r.aging?.over90 ?? 0)) },
    {
      key: 'due',
      header: t('columns.creditDue'),
      align: 'right',
      sortValue: (r) => r.due,
      render: (r) => withCurrency(r.due),
      cellClass: (r) => cn(r.due > 0.009 && 'font-semibold', r.creditLimit && r.due > r.creditLimit ? 'text-red-700' : ''),
      total: (rs) => withCurrency(sumBy(rs, (r) => r.due)),
    },
  ];

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
      <ReportKpis items={kpis} />
      <ReportInsights items={insights} />

      <h2 className="text-sm font-semibold text-neutral-700 mb-2">{t('credit.agingTitle')}</h2>
      <div className="overflow-x-auto rounded-lg border border-neutral-200 mb-5 max-w-2xl">
        <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={t('credit.agingTitle')}>
          <thead className="bg-neutral-50">
            <tr>
              <th className="py-2.5 pl-4 pr-3 text-left text-sm font-semibold text-neutral-700">{t('credit.age')}</th>
              <th className="py-2.5 px-3 text-right text-sm font-semibold text-neutral-700">{t('columns.amount')}</th>
              <th className="py-2.5 pr-4 pl-3 text-right text-sm font-semibold text-neutral-700">%</th>
              {!singleCustomer && (
                <th className="py-2.5 pr-4 pl-3 text-right text-sm font-semibold text-neutral-700">{t('credit.customers')}</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {agingRows.map((r) => (
              <tr key={r.key}>
                <td className="py-2 pl-4 pr-3 text-sm">{r.label}</td>
                <td className={cn('py-2 px-3 text-right text-sm', r.amount > 0.009 && r.tone)}>{withCurrency(r.amount)}</td>
                <td className="py-2 pr-4 pl-3 text-right text-sm">
                  <div className="flex items-center justify-end gap-2">
                    <div className="hidden sm:block w-24 h-2 bg-neutral-100 rounded" data-xlsx-ignore>
                      <div className="h-2 rounded bg-primary-500" style={{ width: `${pctOf(r.amount, agingTotal)}%` }} />
                    </div>
                    <span>{pctOf(r.amount, agingTotal)} %</span>
                  </div>
                </td>
                {!singleCustomer && (
                  <td className="py-2 pr-4 pl-3 text-right text-sm">
                    {rows.filter((row) => (row.aging?.[r.key] ?? 0) > 0.009).length}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-neutral-50 font-semibold">
            <tr>
              <td className="py-2 pl-4 pr-3 text-sm">{t('columns.total')}</td>
              <td className="py-2 px-3 text-right text-sm">{withCurrency(agingTotal)}</td>
              <td className="py-2 pr-4 pl-3 text-right text-sm">100 %</td>
              {!singleCustomer && <td className="py-2 pr-4 pl-3 text-right text-sm">{debtorCount}</td>}
            </tr>
          </tfoot>
        </table>
      </div>

      {!singleCustomer && (
        <>
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">{t('credit.byCustomer')}</h2>
          <SortableReportTable
            rows={rows}
            columns={debtorColumns}
            rowKey={(r) => r.customerId}
            initialSort={{ key: 'due', dir: 'desc' }}
            searchPlaceholder={t('credit.searchCustomer')}
            emptyText={t('empty.noCreditBalances')}
            rowTestId="credit-ar-row"
            xlsxTitle={t('credit.byCustomer')}
          />
        </>
      )}

      {singleCustomer && (
        <>
          <h2 className="text-sm font-semibold text-neutral-700 mb-2">{t('credit.chargesTitle')}</h2>
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
              {orders.length > 0 && (
                <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
                  <tr>
                    <td className="py-2.5 pl-6 pr-3 text-sm">{t('columns.total')}</td>
                    <td className="py-2.5 px-3 text-sm">{t('labels.creditOrdersCount', { count: orders.length })}</td>
                    <td className="py-2.5 pr-6 pl-3 text-right text-sm">{withCurrency(totals.charged)}</td>
                  </tr>
                </tfoot>
              )}
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
              {settlements.length > 0 && (
                <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
                  <tr>
                    <td className="py-2.5 pl-6 pr-3 text-sm">{t('columns.total')}</td>
                    <td className="py-2.5 px-3 text-sm" />
                    <td className="py-2.5 pr-6 pl-3 text-right text-sm">{withCurrency(totals.settled)}</td>
                  </tr>
                </tfoot>
              )}
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
