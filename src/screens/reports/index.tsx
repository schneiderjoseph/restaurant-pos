import {Layout} from "@/screens/partials/layout.tsx";
import {ReactNode, useEffect, useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import {SalesWeeklyFilter} from "@/components/reports/filters/sales.weekly.filter.tsx";
import {ProductMixWeeklyReportFilter} from "@/components/reports/filters/product.mix.weekly.filter.tsx";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faCheckCircle, faChevronRight} from "@fortawesome/free-solid-svg-icons";
import {AuditFilter} from "@/components/reports/filters/audit.filter.tsx";
import {CashClosingFilter} from "@/components/reports/filters/cash.closing.filter.tsx";
import {DiscountsFilter} from "@/components/reports/filters/discounts.filter.tsx";
import {SalesServerFilter} from "@/components/reports/filters/sales.server.filter.tsx";
import {SalesSummaryFilter} from "@/components/reports/filters/sales.summary.filter.tsx";
import {ProductMixSummaryFilter} from "@/components/reports/filters/product.mix.summary.filter.tsx";
import {ProductHourlyFilter} from "@/components/reports/filters/product.hourly.filter.tsx";
import {ProductListFilter} from "@/components/reports/filters/product.list.filter.tsx";
import {VoidsFilter} from "@/components/reports/filters/voids.filter.tsx";
import {TableSummaryFilter} from "@/components/reports/filters/table.summary.filter.tsx";
import {SalesAdvancedFilter} from "@/components/reports/filters/sales.advanced.filter.tsx";
import {SalesSummary2Filter} from "@/components/reports/filters/sales.summary2.filter.tsx";
import {SalesByCustomerFilter} from "@/components/reports/filters/sales.by.customer.filter.tsx";
import {CustomerCreditFilter} from "@/components/reports/filters/customer.credit.filter.tsx";
import { TipsFilter } from "@/components/reports/filters/tips.filter.tsx";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {SalesDashboardFilter} from "@/components/reports/filters/sales.dashboard.filter.tsx";
import {DeliveryDensityFilter} from "@/components/reports/filters/delivery.density.filter.tsx";
import {MergeOrdersFilter} from "@/components/reports/filters/merge.orders.filter.tsx";
import {SplitOrdersFilter} from "@/components/reports/filters/split.orders.filter.tsx";
import {TaxFilter} from "@/components/reports/filters/tax.filter.tsx";
import {CouponFilter} from "@/components/reports/filters/coupon.filter.tsx";
import {OrderLifecycleFilter} from "@/components/reports/filters/order.lifecycle.filter.tsx";
import {OrderReceiptFilter} from "@/components/reports/filters/order.receipt.filter.tsx";
import {OrderFiscalFilter} from "@/components/reports/filters/order.fiscal.filter.tsx";
import {ExpenseFilter} from "@/components/reports/filters/expense.filter.tsx";
import {CashAuditFilter, KitchenTimingFilter, RoomChargesFilter, ShiftsFilter} from "@/components/reports/filters/operations.filters.tsx";
import {ActivityFilter} from "@/components/reports/filters/activity.filter.tsx";
import {DocumentTitle} from "@/components/common/document-title.tsx";
import {
  isClosingModuleEnabled,
  isDeliveryModuleEnabled,
} from "@/lib/feature-modules.ts";
import { useModuleAccess } from "@/providers/module-access.provider.tsx";
import { NoAccessibleTabs } from "@/components/common/no-accessible-tabs.tsx";

type ReportEntry = {
  filter: ReactNode;
  module: string;
  reportKey: string;
  label: string;
  description: string;
};

type ReportCategory = {
  id: string;
  title: string;
  reports: ReportEntry[];
};

/** Stable permission codes stored in user roles — not translated labels. */
const REPORT_PERMISSION_MODULES: Record<string, string> = {
  salesDashboard: 'reports.sales_dashboard',
  serverSales: 'reports.server_sales',
  salesSummary: 'reports.sales_summary',
  salesSummary2: 'reports.sales_summary_2',
  salesByCustomer: 'reports.sales_by_customer',
  customerCredit: 'reports.customer_credit',
  salesWeekly: 'reports.sales_weekly',
  tips: 'reports.tips',
  advancedSales: 'reports.advanced_sales',
  deliveryDensity: 'reports.delivery_density',
  discount: 'reports.discount',
  tax: 'reports.tax',
  coupon: 'reports.coupon',
  voids: 'reports.voids',
  tablesSummary: 'reports.tables_summary',
  mergeOrders: 'reports.merge_orders',
  splitOrders: 'reports.split_orders',
  orderLifeCycle: 'reports.order_life_cycle',
  orderReceipt: 'reports.order_receipt',
  orderFiscal: 'reports.order_fiscal',
  cashClosing: 'reports.cash_closing',
  expense: 'reports.expense',
  activity: 'reports.activity',
  audit: 'reports.audit',
  productMixWeekly: 'reports.product_mix_weekly',
  productMixSummary: 'reports.product_mix_summary',
  productsHourly: 'reports.products_hourly',
  productList: 'reports.product_list',
  shifts: 'reports.shifts',
  roomCharges: 'reports.room_charges',
  cashAudit: 'reports.cash_audit',
  kitchenTiming: 'reports.kitchen_timing',
};

const buildReportEntries = (
  t: (key: string, options?: Record<string, unknown>) => string,
  reports: Array<{ reportKey: string; filter: ReactNode }>,
): ReportEntry[] =>
  reports.map(({ reportKey, filter }) => ({
    reportKey,
    label: t(`reports.${reportKey}`),
    description: t(`descriptions.${reportKey}`, { defaultValue: '' }),
    filter,
    module: REPORT_PERMISSION_MODULES[reportKey],
  }));

export const Reports = () => {
  const { t } = useTranslation('reports');
  const { t: tNav } = useTranslation('navigation');
  const reportCategories = useMemo((): ReportCategory[] => {
    const categories: ReportCategory[] = [
      {
        id: 'dashboard',
        title: t('categories.dashboard'),
        reports: buildReportEntries(t, [
          { reportKey: 'salesDashboard', filter: <SalesDashboardFilter /> },
        ]),
      },
      {
        id: 'sales',
        title: t('categories.sales'),
        reports: buildReportEntries(t, [
          { reportKey: 'salesSummary', filter: <SalesSummaryFilter /> },
          { reportKey: 'salesSummary2', filter: <SalesSummary2Filter /> },
          { reportKey: 'salesWeekly', filter: <SalesWeeklyFilter /> },
          { reportKey: 'advancedSales', filter: <SalesAdvancedFilter /> },
          { reportKey: 'serverSales', filter: <SalesServerFilter /> },
          { reportKey: 'tablesSummary', filter: <TableSummaryFilter /> },
          { reportKey: 'deliveryDensity', filter: <DeliveryDensityFilter /> },
        ]),
      },
      {
        id: 'customers',
        title: t('categories.customers'),
        reports: buildReportEntries(t, [
          { reportKey: 'customerCredit', filter: <CustomerCreditFilter /> },
          { reportKey: 'roomCharges', filter: <RoomChargesFilter /> },
          { reportKey: 'salesByCustomer', filter: <SalesByCustomerFilter /> },
        ]),
      },
      {
        id: 'cashClosing',
        title: t('categories.cashAndPayments'),
        reports: buildReportEntries(t, [
          { reportKey: 'cashClosing', filter: <CashClosingFilter /> },
          { reportKey: 'shifts', filter: <ShiftsFilter /> },
          { reportKey: 'tips', filter: <TipsFilter /> },
          { reportKey: 'tax', filter: <TaxFilter /> },
        ]),
      },
      {
        id: 'products',
        title: t('categories.products'),
        reports: buildReportEntries(t, [
          { reportKey: 'productMixSummary', filter: <ProductMixSummaryFilter /> },
          { reportKey: 'productMixWeekly', filter: <ProductMixWeeklyReportFilter /> },
          { reportKey: 'productsHourly', filter: <ProductHourlyFilter /> },
          { reportKey: 'productList', filter: <ProductListFilter /> },
        ]),
      },
      {
        id: 'control',
        title: t('categories.control'),
        reports: buildReportEntries(t, [
          { reportKey: 'voids', filter: <VoidsFilter /> },
          { reportKey: 'discount', filter: <DiscountsFilter /> },
          { reportKey: 'coupon', filter: <CouponFilter /> },
          { reportKey: 'mergeOrders', filter: <MergeOrdersFilter /> },
          { reportKey: 'splitOrders', filter: <SplitOrdersFilter /> },
          { reportKey: 'cashAudit', filter: <CashAuditFilter /> },
        ]),
      },
      {
        id: 'orders',
        title: t('categories.orders'),
        reports: buildReportEntries(t, [
          { reportKey: 'orderReceipt', filter: <OrderReceiptFilter /> },
          { reportKey: 'orderLifeCycle', filter: <OrderLifecycleFilter /> },
          { reportKey: 'orderFiscal', filter: <OrderFiscalFilter /> },
        ]),
      },
      {
        id: 'operations',
        title: t('categories.operations'),
        reports: buildReportEntries(t, [
          { reportKey: 'expense', filter: <ExpenseFilter /> },
          { reportKey: 'kitchenTiming', filter: <KitchenTimingFilter /> },
          { reportKey: 'activity', filter: <ActivityFilter /> },
          { reportKey: 'audit', filter: <AuditFilter /> },
        ]),
      },
    ];

    const deliveryEnabled = isDeliveryModuleEnabled();
    const closingEnabled = isClosingModuleEnabled();

    return categories
      .map((category) => ({
        ...category,
        reports: category.reports.filter((report) =>
          (deliveryEnabled || report.reportKey !== 'deliveryDensity')
          && (closingEnabled || report.reportKey !== 'cashClosing')),
      }))
      .filter((category) => category.reports.length > 0);
  }, [t]);

  const { ready } = useModuleAccess();
  const isVisible = useActionVisible();

  const visibleCategories = useMemo(() => {
    if (!ready) return [] as ReportCategory[];
    return reportCategories
      .map((category) => ({
        ...category,
        reports: category.reports.filter((entry) => isVisible(entry.module)),
      }))
      .filter((category) => category.reports.length > 0);
  }, [reportCategories, ready, isVisible]);

  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [subReports, setSubReports] = useState<ReportEntry[]>([]);
  const [selectedReportKey, setSelectedReportKey] = useState('');
  const [filter, setFilter] = useState<ReactNode>();
  const [reportQuery, setReportQuery] = useState('');

  const {protectAction} = useSecurity();

  useEffect(() => {
    if (!ready) return;
    if (!selectedCategoryId) return;
    const category = visibleCategories.find((c) => c.id === selectedCategoryId);
    if (!category) {
      setSelectedCategoryId('');
      setSubReports([]);
      setSelectedReportKey('');
      setFilter(undefined);
      return;
    }
    setSubReports(category.reports);
    if (selectedReportKey && !category.reports.some((r) => r.reportKey === selectedReportKey)) {
      setSelectedReportKey('');
      setFilter(undefined);
    }
  }, [ready, visibleCategories, selectedCategoryId, selectedReportKey]);

  const selectedCategoryTitle =
    visibleCategories.find((c) => c.id === selectedCategoryId)?.title ?? '';
  const selectedReportLabel =
    subReports.find((r) => r.reportKey === selectedReportKey)?.label ?? '';

  const visibleSubReports = useMemo(() => {
    const q = reportQuery.trim().toLowerCase();
    if (q) {
      return visibleCategories
        .flatMap((category) => category.reports)
        .filter((entry) => `${entry.label} ${entry.description}`.toLowerCase().includes(q));
    }
    return subReports.filter((entry) => isVisible(entry.module));
  }, [subReports, isVisible, reportQuery, visibleCategories]);

  return (
    <Layout containerClassName="p-5">
      <DocumentTitle parts={[tNav('sidebar.reports')]} />
      {!ready ? null : visibleCategories.length === 0 ? (
        <NoAccessibleTabs />
      ) : (
      <div className="grid grid-cols-9 gap-5" data-testid="reports-page">
        <div className="col-span-2">
          <div className="bg-white shadow py-5 rounded-lg" data-testid="reports-categories">
            <h1 className="text-xl text-gray-600 px-5">{t('page.title')}</h1>
            <div className="px-5 pt-3">
              <input
                type="search"
                value={reportQuery}
                onChange={(e) => setReportQuery(e.target.value)}
                placeholder={t('page.searchReports')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
                data-testid="reports-search"
              />
            </div>
            <div className="py-5">
              <ul>
                {visibleCategories.map((category) => (
                  <li
                    className="border-b py-2 px-5 flex justify-between cursor-pointer hover:bg-gray-100 items-center"
                    data-testid={`reports-category-${category.id}`}
                    onClick={() => {
                      setSelectedCategoryId(category.id);
                      setSubReports(category.reports);
                      setSelectedReportKey('');
                      setFilter(undefined);
                    }}
                    key={category.id}
                  >
                    {category.title}
                    {selectedCategoryId === category.id && (
                      <FontAwesomeIcon icon={faCheckCircle} className="text-success-700" size="lg" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        {visibleSubReports.length > 0 && (
        <div className="col-span-2">
          <div className="bg-white shadow py-5 rounded-lg" data-testid="reports-subreports">
            <h1 className="text-xl text-gray-600 px-5">{t('page.subReports')}</h1>
            <div className="py-5">
              <ul>
                {visibleSubReports.map((entry) => (
                  <li
                    className="border-b py-2 px-5 flex justify-between cursor-pointer hover:bg-gray-100 items-center"
                    data-testid={`reports-report-${entry.reportKey}`}
                    onClick={() => {
                      protectAction(() => {
                        if (reportQuery.trim()) {
                          const owner = visibleCategories.find((c) => c.reports.some((r) => r.reportKey === entry.reportKey));
                          if (owner) {
                            setSelectedCategoryId(owner.id);
                            setSubReports(owner.reports);
                          }
                          setReportQuery('');
                        }
                        setSelectedReportKey(entry.reportKey);
                        setFilter(entry.filter);
                      }, {
                        module: entry.module,
                        description: t('security.openReport', { report: entry.label })
                      });
                    }}
                    key={entry.reportKey}
                  >
                    <span className="flex flex-col">
                      <span>{entry.label}</span>
                      {entry.description && (
                        <span className="text-xs text-gray-500">{entry.description}</span>
                      )}
                    </span>
                    {selectedReportKey === entry.reportKey && (
                      <FontAwesomeIcon icon={faCheckCircle} className="text-success-700" size="lg" />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
        )}
        <div className="col-span-5">
          <div className="bg-white shadow p-5 rounded-lg" data-testid="reports-filters">
            <h1 className="text-xl">
              {selectedCategoryId && selectedReportKey ? (
                <span className="text-gray-600">{selectedCategoryTitle} <FontAwesomeIcon icon={faChevronRight} size="xs" /> {selectedReportLabel}</span>
              ) : t('page.reportFilters')}
            </h1>
            <div className="py-5">
              {filter && filter}
            </div>
          </div>
        </div>
      </div>
      )}

    </Layout>
  );
};
