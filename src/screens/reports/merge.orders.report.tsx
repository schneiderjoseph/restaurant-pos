import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {formatNumber} from "@/lib/utils.ts";
import {ReportKpis} from "@/components/reports/report-kpis.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {GroupTable, groupSum} from "@/components/reports/group-table.tsx";
import {toLuxonDateTime} from "@/lib/datetime.ts";

type MergeRow = {
  id: string;
  created_at: unknown;
  created_by?: {first_name?: string; last_name?: string};
  new_order?: {id?: string; invoice_number?: number};
  old_orders?: Array<{id?: string; invoice_number?: number}>;
};

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start") || params.get("start");
  const endDate = params.get("end") || params.get("end");
  return {startDate, endDate};
};

export const MergeOrdersReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [rows, setRows] = useState<MergeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(parseFilters, []);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : undefined;

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const conditions: string[] = [];
        const params: Record<string, string> = {};

        if (filters.startDate) {
          conditions.push(`time::format(created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") >= $startDate`);
          params.startDate = filters.startDate;
        }
        if (filters.endDate) {
          conditions.push(`time::format(created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") <= $endDate`);
          params.endDate = filters.endDate;
        }

        const query = `
          SELECT * FROM ${Tables.order_merge}
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
          ORDER BY created_at DESC
          FETCH created_by, new_order, old_orders
        `;
        const [result] = await queryRef.current(query, params);
        setRows((result || []) as MergeRow[]);
      } catch (err) {
        console.error("Failed to load merge orders report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [filters.endDate, filters.startDate, t]);

  if (loading) {
    return <ReportsLayout title={t('titles.mergeOrders')} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.mergeOrders')}</div></ReportsLayout>;
  }

  if (error) {
    return <ReportsLayout title={t('titles.mergeOrders')} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  const byName = (row: MergeRow) => `${row.created_by?.first_name || ""} ${row.created_by?.last_name || ""}`.trim() || "-";
  const orderLabel = (o?: {id?: string; invoice_number?: number}) => (o?.invoice_number ? `#${o.invoice_number}` : o?.id || "-");
  const oldLabels = (row: MergeRow) => ((row.old_orders || []).length > 0 ? (row.old_orders || []).map(orderLabel).join(", ") : "-");
  const byUser = groupSum(rows, byName, () => 0);
  const mergedOrders = rows.reduce((sum, row) => sum + (row.old_orders?.length ?? 0), 0);
  const columns: ReportColumn<MergeRow>[] = [
    {key: 'at', header: t('columns.mergedAt'), sortValue: (r) => toLuxonDateTime(r.created_at as never).toMillis(), render: (r) => toLuxonDateTime(r.created_at as never).toFormat("yyyy-LL-dd HH:mm")},
    {key: 'by', header: t('columns.mergedBy'), sortValue: byName, searchValue: byName, render: byName},
    {key: 'new', header: t('columns.newOrder'), searchValue: (r) => orderLabel(r.new_order), render: (r) => orderLabel(r.new_order)},
    {key: 'old', header: t('columns.oldOrders'), searchValue: oldLabels, render: oldLabels, cellClass: () => 'whitespace-normal'},
  ];

  return (
    <ReportsLayout title={t('titles.mergeOrders')} subtitle={subtitle}>
      <ReportKpis items={[
        {label: t('labels.totalMergeEvents'), value: formatNumber(rows.length), rawValue: rows.length, rawFormat: 'integer'},
        {label: t('mergeReport.mergedOrders'), value: formatNumber(mergedOrders), rawValue: mergedOrders, rawFormat: 'integer'},
        {label: t('mergeReport.topUser'), value: byUser[0]?.name ?? '—', hint: byUser[0] ? t('activityReport.actionsCount', {count: byUser[0].count}) : undefined},
      ]}/>
      {byUser.length > 1 && (
        <div className="max-w-xl">
          <GroupTable title={t('activityReport.byUser')} nameHeader={t('columns.mergedBy')} rows={byUser} showAmount={false}/>
        </div>
      )}
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        initialSort={{key: 'at', dir: 'desc'}}
        searchPlaceholder={t('mergeReport.search')}
        emptyText={t('empty.noMergeEvents')}
        xlsxTitle={t('titles.mergeOrders')}
      />
    </ReportsLayout>
  );
};
