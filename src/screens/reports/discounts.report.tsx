import {useEffect, useMemo, useRef, useState} from "react";
import {useTranslation} from "react-i18next";
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Order} from "@/api/model/order.ts";
import {OrderDiscount} from "@/api/model/order_discount.ts";
import {DiscountReason} from "@/api/model/discount_reason.ts";
import {User} from "@/api/model/user.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {formatNumber, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {ReportInsights, type ReportInsight} from "@/components/reports/report-insights.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {GroupTable, groupSum} from "@/components/reports/group-table.tsx";
import {listNames} from "@/api/reports/insights/credit.ts";
import {
  aggregateOrderDiscountBreakdown,
  getInvoiceNumber,
} from "@/lib/order.ts";
import {buildRecordInsideCondition} from "@/api/reports/shared/query.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeOrderId = (value: unknown): string => {
  const full = recordIdToString(value);
  if (!full) {
    return "";
  }
  return full.includes(":") ? full.split(":").slice(1).join(":") : full;
};

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  return {
    startDate: params.get("start") || "",
    endDate: params.get("end") || "",
    discountId: params.get("discount_id") || "",
  };
};

const formatPersonName = (person?: User | string | null): string => {
  if (!person) {
    return "-";
  }
  if (typeof person === "string") {
    return person.includes(":") ? "-" : person;
  }
  const full = `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim();
  return full || person.login || "-";
};

const formatReason = (line: Pick<OrderDiscount, "reason" | "reason_text">): string => {
  const reasonRef = line.reason;
  let reasonLabel = "";

  if (reasonRef && typeof reasonRef === "object" && "name" in reasonRef) {
    reasonLabel = String((reasonRef as DiscountReason).name ?? "").trim();
  } else if (typeof reasonRef === "string" && reasonRef && !reasonRef.includes(":")) {
    reasonLabel = reasonRef.trim();
  }

  const reasonText = typeof line.reason_text === "string" ? line.reason_text.trim() : "";
  const parts = [reasonLabel, reasonText].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : "-";
};

const formatValueType = (line: {
  value_type?: string | null;
  applied_rate?: number | null;
}): string => {
  const rate = safeNumber(line.applied_rate);
  const valueType = line.value_type || "";

  if (valueType === "percent") {
    return rate > 0 ? `${formatNumber(rate)}%` : "Percent";
  }
  if (valueType === "fixed_amount") {
    return rate > 0 ? withDualCurrency(rate) : "Fixed amount";
  }
  if (valueType === "fixed_price") {
    return rate > 0 ? withDualCurrency(rate) : "Fixed price";
  }
  if (rate > 0) {
    return `${formatNumber(rate)}%`;
  }
  return "-";
};

interface DiscountDetailRow {
  key: string;
  orderId: string;
  createdAt: Order["created_at"] | OrderDiscount["created_at"];
  invoiceLabel: string;
  cashierName: string;
  discountName: string;
  scope: string;
  valueTypeLabel: string;
  amount: number;
  applicationType: string;
  reason: string;
  appliedBy: string;
  approvedBy: string;
}

const getOrderFromLine = (line: OrderDiscount): Order | null => {
  const orderRef = line.order;
  if (!orderRef || typeof orderRef !== "object") {
    return null;
  }
  // RecordId has tb/id but no invoice_number — treat as unresolved.
  if (!("invoice_number" in orderRef) && !("status" in orderRef) && !("cashier" in orderRef)) {
    return null;
  }
  return orderRef as Order;
};

const getLineOrderId = (line: OrderDiscount): string => {
  const order = getOrderFromLine(line);
  if (order?.id) {
    return normalizeOrderId(order.id);
  }
  return normalizeOrderId(line.order);
};

const getCashierName = (order?: Order | null): string => {
  if (!order) {
    return "-";
  }
  const cashier = order.cashier as User | undefined;
  const user = order.user as User | undefined;
  return formatPersonName(cashier || user);
};

const buildDetailRows = (lines: OrderDiscount[]): DiscountDetailRow[] => {
  return lines.map((line, index) => {
    const order = getOrderFromLine(line);
    const orderId = getLineOrderId(line) || `unknown-${index}`;
    const invoiceLabel = order?.invoice_number != null
      ? `#${getInvoiceNumber(order)}`
      : orderId;
    const discountRef = line.discount;
    const discountName = line.name
      || (typeof discountRef === "object" && discountRef !== null && "name" in discountRef
        ? String((discountRef as {name?: string}).name ?? "")
        : typeof discountRef === "string" ? discountRef : "Discount");

    return {
      key: line.id?.toString?.() ?? `line-${index}`,
      orderId,
      createdAt: order?.created_at ?? line.created_at,
      invoiceLabel,
      cashierName: getCashierName(order),
      discountName: discountName || "Discount",
      scope: line.scope || "-",
      valueTypeLabel: formatValueType(line),
      amount: safeNumber(line.applied_amount),
      applicationType: line.application_type || "-",
      reason: formatReason(line),
      appliedBy: formatPersonName(line.applied_by),
      approvedBy: formatPersonName(line.approved_by),
    };
  });
};

const groupLinesOntoOrders = (lines: OrderDiscount[]): Order[] => {
  const map = new Map<string, Order>();

  lines.forEach((line) => {
    const order = getOrderFromLine(line);
    if (!order?.id) {
      return;
    }
    const orderId = normalizeOrderId(order.id);
    const existing = map.get(orderId);
    if (existing) {
      existing.order_discounts = [...(existing.order_discounts ?? []), line];
      return;
    }
    map.set(orderId, {...order, order_discounts: [line]});
  });

  return Array.from(map.values());
};

export const DiscountsReport = () => {
  const {t} = useTranslation("reports");
  const db = useDB();
  const queryRef = useRef(db.query);
  const [orderDiscounts, setOrderDiscounts] = useState<OrderDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(parseFilters, []);
  const subtitle = filters.startDate && filters.endDate
    ? `${filters.startDate} to ${filters.endDate}`
    : undefined;

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const conditions = [
          `(removed_at = NONE or removed_at = null)`,
          `order.status = 'Paid'`,
        ];
        const params: Record<string, any> = {};

        if (filters.startDate) {
          conditions.push(
            `time::format(order.created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") >= $startDate`,
          );
          params.startDate = filters.startDate;
        }
        if (filters.endDate) {
          conditions.push(
            `time::format(order.created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") <= $endDate`,
          );
          params.endDate = filters.endDate;
        }
        if (filters.discountId) {
          const discountFilter = buildRecordInsideCondition("discount", [filters.discountId], "discountIds");
          if (discountFilter.condition) {
            conditions.push(discountFilter.condition);
            Object.assign(params, discountFilter.params);
          }
        }

        const query = `
          SELECT * FROM ${Tables.order_discounts}
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC
          FETCH order, order.cashier, order.user, discount, reason, applied_by, approved_by
        `;

        const [result] = await queryRef.current(query, params);
        setOrderDiscounts((result || []) as OrderDiscount[]);
      } catch (err) {
        console.error("Failed to load discounts report", err);
        setError(err instanceof Error ? err.message : t("errors.unableToLoad"));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [filters.discountId, filters.endDate, filters.startDate]);

  const detailRows = useMemo(() => buildDetailRows(orderDiscounts), [orderDiscounts]);

  const summaryOrders = useMemo(
    () => groupLinesOntoOrders(orderDiscounts),
    [orderDiscounts],
  );

  const discountTypes = useMemo(
    () => aggregateOrderDiscountBreakdown(summaryOrders, "name", t("labels.customDiscount")),
    [summaryOrders, t],
  );

  const totalDiscount = useMemo(
    () => detailRows.reduce((sum, row) => sum + row.amount, 0),
    [detailRows],
  );

  const orderCount = useMemo(() => {
    const ids = new Set(detailRows.map((row) => row.orderId));
    return ids.size;
  }, [detailRows]);

  const noValue = (v: string) => !v || v === "-";
  const byApplier = useMemo(() => groupSum(detailRows, (r) => (noValue(r.appliedBy) ? t("voidsReport.unknown") : r.appliedBy), (r) => r.amount), [detailRows, t]);
  const byReason = useMemo(() => groupSum(detailRows, (r) => (noValue(r.reason) ? t("discountReport.noReason") : r.reason), (r) => r.amount), [detailRows, t]);
  const byApprover = useMemo(() => groupSum(detailRows.filter((r) => !noValue(r.approvedBy)), (r) => r.approvedBy, (r) => r.amount), [detailRows]);
  const withoutReason = detailRows.filter((r) => noValue(r.reason)).length;
  const selfApproved = detailRows.filter((r) => !noValue(r.approvedBy) && r.approvedBy === r.appliedBy);

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (detailRows.length === 0) {
      out.push({id: "none", severity: "good", text: t("insights.discounts.none")});
      return out;
    }
    const pct = (part: number) => (totalDiscount > 0 ? Math.round((part / totalDiscount) * 100) : 0);
    const top = discountTypes[0] ? [...discountTypes].sort((x, y) => y.total - x.total)[0] : null;
    if (top) out.push({id: "top", severity: "info", text: t("insights.discounts.top", {name: top.name, amount: withCurrency(top.total), pct: pct(top.total), count: top.quantity})});
    if (byApplier.length >= 2 && pct(byApplier[0].amount) >= 40) {
      out.push({id: "applier", severity: "warn", text: t("insights.discounts.applierConcentration", {name: byApplier[0].name, pct: pct(byApplier[0].amount), amount: withCurrency(byApplier[0].amount)})});
    }
    if (withoutReason > 0) {
      out.push({id: "no-reason", severity: withoutReason / detailRows.length >= 0.3 ? "warn" : "info", text: t("insights.discounts.withoutReason", {count: withoutReason, pct: Math.round((withoutReason / detailRows.length) * 100)})});
    }
    if (selfApproved.length > 0) {
      out.push({id: "self-approved", severity: "warn", text: t("insights.discounts.selfApproved", {count: selfApproved.length, names: listNames([...new Set(selfApproved.map((r) => r.appliedBy))], (k, p) => String(t(k, p as never)))})});
    }
    if (orderCount > 0) {
      out.push({id: "avg", severity: "info", text: t("insights.discounts.average", {avg: withCurrency(totalDiscount / orderCount), orders: orderCount})});
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailRows, discountTypes, byApplier, withoutReason, selfApproved.length, totalDiscount, orderCount, t]);

  if (loading) {
    return (
      <ReportsLayout title={t("titles.discount")} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t("loading.discounts")}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={t("titles.discount")} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">{t("errors.failedToLoad", {error})}</div>
      </ReportsLayout>
    );
  }

  type TypeRow = (typeof discountTypes)[number];
  const typeColumns: ReportColumn<TypeRow>[] = [
    {key: "name", header: t("columns.name"), sortValue: (r) => r.name.toLowerCase(), render: (r) => <span className="font-medium">{r.name}</span>, total: () => t("columns.total")},
    {key: "rate", header: t("columns.valueType"), align: "right", render: (r) => r.rateLabel},
    {key: "qty", header: t("columns.quantity"), align: "right", sortValue: (r) => r.quantity, render: (r) => formatNumber(r.quantity), total: (rs) => formatNumber(rs.reduce((x, r) => x + r.quantity, 0))},
    {key: "amount", header: t("columns.amount"), align: "right", sortValue: (r) => r.total, render: (r) => withCurrency(r.total), total: (rs) => withCurrency(rs.reduce((x, r) => x + r.total, 0))},
    {key: "pct", header: "%", align: "right", sortValue: (r) => r.total, render: (r) => `${totalDiscount > 0 ? Math.round((r.total / totalDiscount) * 100) : 0} %`},
  ];

  type Detail = (typeof detailRows)[number];
  const detailColumns: ReportColumn<Detail>[] = [
    {key: "date", header: t("columns.date"), sortValue: (r) => toLuxonDateTime(r.createdAt as never).toMillis(), render: (r) => toLuxonDateTime(r.createdAt as never).toFormat("yyyy-LL-dd HH:mm"), total: () => t("columns.total")},
    {key: "order", header: t("columns.order"), sortValue: (r) => r.invoiceLabel, searchValue: (r) => r.invoiceLabel, render: (r) => r.invoiceLabel},
    {key: "cashier", header: t("metrics.cashier"), sortValue: (r) => r.cashierName, searchValue: (r) => r.cashierName, render: (r) => r.cashierName || "-"},
    {key: "discount", header: t("columns.discount"), sortValue: (r) => r.discountName, searchValue: (r) => r.discountName, render: (r) => <span className="font-medium">{r.discountName}</span>},
    {key: "scope", header: t("columns.scope"), render: (r) => <span className="capitalize">{r.scope}</span>},
    {key: "rate", header: t("columns.valueType"), align: "right", render: (r) => r.valueTypeLabel},
    {key: "amount", header: t("columns.amount"), align: "right", sortValue: (r) => r.amount, render: (r) => withCurrency(r.amount), total: (rs) => withCurrency(rs.reduce((x, r) => x + r.amount, 0))},
    {key: "application", header: t("columns.applicationType"), render: (r) => <span className="capitalize">{r.applicationType}</span>},
    {key: "reason", header: t("columns.reason"), searchValue: (r) => r.reason, render: (r) => (noValue(r.reason) ? <span className="text-amber-700">{t("discountReport.noReason")}</span> : r.reason), cellClass: () => "whitespace-normal"},
    {key: "appliedBy", header: t("columns.appliedBy"), sortValue: (r) => r.appliedBy, searchValue: (r) => r.appliedBy, render: (r) => r.appliedBy},
    {key: "approvedBy", header: t("columns.approvedBy"), sortValue: (r) => r.approvedBy, searchValue: (r) => r.approvedBy, render: (r) => r.approvedBy, cellClass: (r) => (!noValue(r.approvedBy) && r.approvedBy === r.appliedBy ? "text-amber-700" : "")},
  ];

  const kpis: ReportKpi[] = [
    {label: t("labels.totalDiscount"), value: withDualCurrency(totalDiscount), rawValue: totalDiscount},
    {label: t("categories.orders"), value: formatNumber(orderCount), rawValue: orderCount, rawFormat: "integer", hint: t("discountReport.lines", {count: detailRows.length})},
    {label: t("discountReport.avgPerOrder"), value: withCurrency(orderCount ? totalDiscount / orderCount : 0), rawValue: orderCount ? totalDiscount / orderCount : 0},
    {label: t("discountReport.withoutReason"), value: formatNumber(withoutReason), rawValue: withoutReason, rawFormat: "integer", tone: withoutReason > 0 ? "warn" : "good"},
  ];

  return (
    <ReportsLayout title={t("titles.discount")} subtitle={subtitle}>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
        <div>
          <h2 className="text-base font-semibold text-neutral-800 mb-2">{t("labels.discountTypes")}</h2>
          <SortableReportTable rows={discountTypes} columns={typeColumns} rowKey={(r) => `${r.name}-${r.rateLabel}`} initialSort={{key: "amount", dir: "desc"}} emptyText={t("empty.noDiscountTypes")} xlsxTitle={t("labels.discountTypes")}/>
        </div>
        <GroupTable title={t("discountReport.byApplier")} nameHeader={t("columns.appliedBy")} rows={byApplier}/>
        <GroupTable title={t("discountReport.byReason")} nameHeader={t("columns.reason")} rows={byReason}/>
        {byApprover.length > 0 && <GroupTable title={t("discountReport.byApprover")} nameHeader={t("columns.approvedBy")} rows={byApprover}/>}
      </div>
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t("labels.discountDetails")}</h2>
      <SortableReportTable
        rows={detailRows}
        columns={detailColumns}
        rowKey={(r) => r.key}
        initialSort={{key: "date", dir: "asc"}}
        searchPlaceholder={t("discountReport.search")}
        emptyText={t("empty.noDiscountRows")}
        xlsxTitle={t("labels.discountDetails")}
      />
    </ReportsLayout>
  );
};
