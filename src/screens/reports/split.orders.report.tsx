import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {formatTableLabel} from "@/lib/table-label.ts";
import {reportsAsWalkIn} from "@/lib/guest.ts";
import {ReportKpis} from "@/components/reports/report-kpis.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {GroupTable, groupSum} from "@/components/reports/group-table.tsx";

type SplitOrderRow = {
  id: string;
  created_at: unknown;
  invoice_number?: number;
  split?: number;
  status?: string;
  tags?: string[];
  user?: {first_name?: string; last_name?: string};
  table?: {name?: string; number?: string | number; source?: string | null; asi_alias?: string | null};
  customer?: {source?: string | null};
};

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start") || params.get("start");
  const endDate = params.get("end") || params.get("end");
  return {startDate, endDate};
};

export const SplitOrdersReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [rows, setRows] = useState<SplitOrderRow[]>([]);
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

        const conditions = [
          `(split != NONE OR status = 'Spilt' OR tags CONTAINS 'Split' OR tags CONTAINS 'Split Order')`,
        ];
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
          SELECT * FROM ${Tables.orders}
          WHERE ${conditions.join(" AND ")}
          ORDER BY created_at DESC
          FETCH user, table, customer
        `;

        const [result] = await queryRef.current(query, params);
        setRows((result || []) as SplitOrderRow[]);
      } catch (err) {
        console.error("Failed to load split orders report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [filters.endDate, filters.startDate, t]);

  if (loading) {
    return <ReportsLayout title={t('titles.splitOrders')} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.splitOrders')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={t('titles.splitOrders')} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  const userName = (row: SplitOrderRow) => `${row.user?.first_name || ""} ${row.user?.last_name || ""}`.trim() || "-";
  const tableLabel = (row: SplitOrderRow) => (!row.table
    ? "-"
    : reportsAsWalkIn(row as never)
      ? t("labels.walkIn")
      : row.table.name || row.table.source === "asi-room"
        ? formatTableLabel(row.table as never)
        : `Table ${row.table.number ?? ""}`.trim());
  const orderLabel = (row: SplitOrderRow) => (row.invoice_number ? `#${row.invoice_number}` : row.id);
  const byUser = groupSum(rows, userName, () => 0);
  const byTable = groupSum(rows, tableLabel, () => 0);
  const columns: ReportColumn<SplitOrderRow>[] = [
    {key: 'at', header: t('columns.createdAt'), sortValue: (r) => toLuxonDateTime(r.created_at as never).toMillis(), render: (r) => toLuxonDateTime(r.created_at as never).toFormat("yyyy-LL-dd HH:mm")},
    {key: 'order', header: t('columns.order'), sortValue: (r) => r.invoice_number ?? 0, searchValue: orderLabel, render: orderLabel},
    {key: 'split', header: t('columns.splitNumber'), sortValue: (r) => r.split ?? 0, render: (r) => r.split ?? "-"},
    {key: 'status', header: t('filters.status'), sortValue: (r) => r.status || '', searchValue: (r) => r.status || '', render: (r) => r.status || "-"},
    {key: 'table', header: t('filters.table'), sortValue: tableLabel, searchValue: tableLabel, render: tableLabel},
    {key: 'user', header: t('filters.user'), sortValue: userName, searchValue: userName, render: userName},
  ];

  return (
    <ReportsLayout title={t('titles.splitOrders')} subtitle={subtitle}>
      <ReportKpis items={[
        {label: t('splitReport.orders'), value: String(rows.length), rawValue: rows.length, rawFormat: 'integer'},
        {label: t('mergeReport.topUser'), value: byUser[0]?.name ?? '—', hint: byUser[0] ? t('activityReport.actionsCount', {count: byUser[0].count}) : undefined},
        {label: t('splitReport.topTable'), value: byTable[0]?.name ?? '—', hint: byTable[0] ? t('activityReport.actionsCount', {count: byTable[0].count}) : undefined},
      ]}/>
      {rows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
          <GroupTable title={t('activityReport.byUser')} nameHeader={t('filters.user')} rows={byUser} showAmount={false}/>
          <GroupTable title={t('splitReport.byTable')} nameHeader={t('filters.table')} rows={byTable} showAmount={false}/>
        </div>
      )}
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        initialSort={{key: 'at', dir: 'desc'}}
        searchPlaceholder={t('mergeReport.search')}
        emptyText={t('empty.noSplitOrders')}
        xlsxTitle={t('titles.splitOrders')}
      />
    </ReportsLayout>
  );
};
