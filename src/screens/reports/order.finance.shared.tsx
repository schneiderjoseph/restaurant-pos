import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Order} from "@/api/model/order.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {formatNumber, toRecordId, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {GroupTable, groupSum} from "@/components/reports/group-table.tsx";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {getOrderTaxAmount, getOrderTaxBreakdown} from "@/lib/tax-calculator.ts";
import {getOrderFilteredItems, getOrderDiscountTotal, getOrderExtrasTotal} from "@/lib/order.ts";
import {
  buildNestedRecordAnyCondition,
  buildRecordInsideCondition,
} from "@/api/reports/shared/query.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";

type MetricKey = "discount_amount" | "tax_amount" | "coupon_discount";

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start") || params.get("start");
  const endDate = params.get("end") || params.get("end");
  const taxId = params.get("tax_id") || "";
  const discountId = params.get("discount_id") || "";
  const couponId = params.get("coupon_id") || "";
  return {startDate, endDate, taxId, discountId, couponId};
};

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const taxIdsMatch = (left: unknown, right: unknown) => {
  const a = recordIdToString(left);
  const b = recordIdToString(right);
  return Boolean(a && b && a === b);
};

const getFilteredTaxAmount = (order: Order, taxId: string) => {
  if (!taxId) {
    return getOrderTaxAmount(order);
  }

  const target = toRecordId(taxId.includes(":") ? taxId : `${Tables.taxes}:${taxId}`);
  const junctionRows = (order.order_taxes ?? []).filter((row) => taxIdsMatch(row.tax, target));
  if (junctionRows.length > 0) {
    return junctionRows.reduce((sum, row) => sum + safeNumber(row.amount), 0);
  }

  if (taxIdsMatch(order.tax, target)) {
    return getOrderTaxAmount(order);
  }

  return 0;
};

const getMetricAmount = (order: Order, metric: MetricKey, taxId = "") => {
  if (metric === "coupon_discount") {
    return safeNumber(order.coupon?.discount);
  }
  if (metric === "discount_amount") {
    return getOrderDiscountTotal(order);
  }
  if (metric === "tax_amount") {
    return getFilteredTaxAmount(order, taxId);
  }
  return safeNumber((order as any)?.[metric]);
};

const formatTaxPercent = (order: Order, taxId = "") => {
  if (taxId) {
    const target = toRecordId(taxId.includes(":") ? taxId : `${Tables.taxes}:${taxId}`);
    const matchedRows = (order.order_taxes ?? []).filter((row) => taxIdsMatch(row.tax, target));
    if (matchedRows.length > 0) {
      return matchedRows.map((row) => {
        const tax = typeof row.tax === "object" && row.tax !== null ? row.tax : null;
        const rate = safeNumber(tax?.rate);
        const name = tax?.name;
        return name ? `${name} ${rate}%` : `${rate}%`;
      }).join(", ");
    }
    if (taxIdsMatch(order.tax, target)) {
      const legacyRate = safeNumber((order.tax as any)?.rate);
      return legacyRate > 0 ? `${legacyRate}%` : "-";
    }
    return "-";
  }

  const breakdown = getOrderTaxBreakdown(order);
  if (breakdown.length === 0) {
    const legacyRate = safeNumber((order.tax as any)?.rate);
    return legacyRate > 0 ? `${legacyRate}%` : "-";
  }
  if (breakdown.length === 1) {
    return `${breakdown[0].rate}%`;
  }
  return breakdown.map((entry) => `${entry.name} ${entry.rate}%`).join(", ");
};

const calculateGross = (order: Order) => {
  const itemsTotal = getOrderFilteredItems(order).reduce(
    (sum, item) => sum + safeNumber(calculateOrderItemPrice(item)),
    0,
  );
  return itemsTotal + getOrderExtrasTotal(order);
};

interface Props {
  title: string;
  metric: MetricKey;
  metricHeader: string;
}

export const OrderFinanceReport = ({title, metric, metricHeader}: Props) => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(parseFilters, []);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : undefined;

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const conditions = [`status = 'Paid'`];
        const params: Record<string, any> = {};

        if (filters.startDate) {
          conditions.push(`time::format(created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") >= $startDate`);
          params.startDate = filters.startDate;
        }
        if (filters.endDate) {
          conditions.push(`time::format(created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") <= $endDate`);
          params.endDate = filters.endDate;
        }

        if (metric === "coupon_discount") {
          conditions.push(`coupon != NONE`);
        } else if (metric === "discount_amount") {
          conditions.push(`(discount != NONE OR (order_discounts != NONE AND array::len(order_discounts) > 0) OR coupon != NONE)`);
        } else {
          conditions.push(`(tax_amount > 0 OR (order_taxes != NONE AND array::len(order_taxes) > 0))`);
        }

        if (metric === "tax_amount" && filters.taxId) {
          const taxIds = [filters.taxId];
          const legacyTax = buildRecordInsideCondition("tax", taxIds, "taxIds");
          const junctionTax = buildNestedRecordAnyCondition("order_taxes.tax", taxIds, "orderTax");
          const parts = [legacyTax.condition, junctionTax.condition].filter(Boolean);
          Object.assign(params, legacyTax.params, junctionTax.params);
          if (parts.length > 0) {
            conditions.push(`(${parts.join(" OR ")})`);
          }
        }

        if (metric === "coupon_discount" && filters.couponId) {
          conditions.push(`coupon.coupon = $couponId`);
          params.couponId = toRecordId(filters.couponId.includes(":") ? filters.couponId : `${Tables.coupons}:${filters.couponId}`);
        }

        if (metric === "discount_amount" && filters.discountId) {
          const discountIds = [filters.discountId];
          const discountInside = buildRecordInsideCondition("discount", discountIds, "discountIds");
          const discountLines = buildNestedRecordAnyCondition("order_discounts.discount", discountIds, "orderDiscount");
          const parts = [discountInside.condition, discountLines.condition].filter(Boolean);
          Object.assign(params, discountInside.params, discountLines.params);
          if (parts.length > 0) {
            conditions.push(`(${parts.join(" OR ")})`);
          }
        }

        const query = `
          SELECT * FROM ${Tables.orders}
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC
          FETCH user, cashier, coupon, coupon.coupon, tax, discount, items, items.taxes, items.tax_mode, extras, order_taxes, order_taxes.tax, order_discounts, order_discounts.discount
        `;

        const [result] = await queryRef.current(query, params);
        if (!cancelled) {
          setOrders((result || []) as Order[]);
        }
      } catch (err) {
        console.error(`Failed to load ${title}`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchData();
    return () => {
      cancelled = true;
    };
  }, [filters.couponId, filters.discountId, filters.endDate, filters.startDate, filters.taxId, metric, title, t]);

  const totalMetric = useMemo(() => {
    return orders.reduce((sum, order) => sum + getMetricAmount(order, metric, filters.taxId), 0);
  }, [orders, metric, filters.taxId]);

  const lines = useMemo(() => orders.map((order) => {
    const gross = calculateGross(order);
    const amount = getMetricAmount(order, metric, filters.taxId);
    const net = gross + getOrderTaxAmount(order) + safeNumber(order.service_charge_amount) + safeNumber(order.tip_amount)
      - getOrderDiscountTotal(order);
    const cashier = `${(order.cashier as any)?.first_name || (order.user as any)?.first_name || ""} ${(order.cashier as any)?.last_name || (order.user as any)?.last_name || ""}`.trim() || "-";
    return {
      id: order.id.toString(),
      order,
      at: toLuxonDateTime(order.created_at as never),
      label: order.invoice_number ? `#${order.invoice_number}` : order.id.toString(),
      cashier,
      gross,
      amount,
      net,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [orders, metric, filters.taxId]);
  const byCashier = useMemo(() => groupSum(lines, (l) => l.cashier, (l) => l.amount), [lines]);

  if (loading) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.report')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={title} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  type Line = (typeof lines)[number];
  const sumOf = (ls: Line[], f: (l: Line) => number) => ls.reduce((acc, l) => acc + f(l), 0);
  const totalGross = sumOf(lines, (l) => l.gross);
  const columns: ReportColumn<Line>[] = [
    {key: 'at', header: t('columns.createdAt'), sortValue: (l) => l.at.toMillis(), render: (l) => l.at.toFormat("yyyy-LL-dd HH:mm"), total: () => t('columns.total')},
    {key: 'order', header: t('columns.order'), sortValue: (l) => l.label, searchValue: (l) => l.label, render: (l) => l.label},
    {key: 'cashier', header: t('metrics.cashier'), sortValue: (l) => l.cashier, searchValue: (l) => l.cashier, render: (l) => l.cashier},
    {key: 'gross', header: t('metrics.gross'), align: 'right', sortValue: (l) => l.gross, render: (l) => withCurrency(l.gross), total: (ls) => withCurrency(sumOf(ls, (l) => l.gross))},
    ...(metric === "tax_amount" ? [{key: 'rate', header: t('columns.taxPercent'), align: 'right' as const, render: (l: Line) => formatTaxPercent(l.order, filters.taxId)}] : []),
    {key: 'amount', header: metricHeader, align: 'right', sortValue: (l) => l.amount, render: (l) => <span className="font-semibold">{withCurrency(l.amount)}</span>, total: (ls) => withCurrency(sumOf(ls, (l) => l.amount))},
    {key: 'net', header: t('metrics.net'), align: 'right', sortValue: (l) => l.net, render: (l) => withCurrency(l.net), total: (ls) => withCurrency(sumOf(ls, (l) => l.net))},
  ];
  const kpis: ReportKpi[] = [
    {label: `${t('columns.total')} ${metricHeader.toLowerCase()}`, value: withDualCurrency(totalMetric), rawValue: totalMetric},
    {label: t('categories.orders'), value: formatNumber(orders.length), rawValue: orders.length, rawFormat: 'integer'},
    {label: t('financeReport.perOrder'), value: withCurrency(orders.length ? totalMetric / orders.length : 0), rawValue: orders.length ? totalMetric / orders.length : 0},
    {label: t('financeReport.shareOfGross'), value: `${totalGross > 0 ? Math.round((totalMetric / totalGross) * 1000) / 10 : 0} %`, rawValue: totalGross > 0 ? totalMetric / totalGross : 0, rawFormat: 'percent'},
  ];

  return (
    <ReportsLayout title={title} subtitle={subtitle}>
      <ReportKpis items={kpis}/>
      {byCashier.length > 1 && (
        <div className="max-w-2xl">
          <GroupTable title={t('financeReport.byCashier')} nameHeader={t('metrics.cashier')} rows={byCashier} countHeader={t('columns.orders')} amountHeader={metricHeader}/>
        </div>
      )}
      <SortableReportTable
        rows={lines}
        columns={columns}
        rowKey={(l) => l.id}
        initialSort={{key: 'at', dir: 'asc'}}
        searchPlaceholder={t('mergeReport.search')}
        emptyText={t('empty.noRows')}
        xlsxTitle={title}
      />
    </ReportsLayout>
  );
};
