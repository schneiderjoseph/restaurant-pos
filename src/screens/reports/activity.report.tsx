import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Tracking} from "@/api/model/tracking.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {detectBrowser, detectOS, displayValue} from "@/screens/reports/activity.utils.ts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {ReportInsights, type ReportInsight} from "@/components/reports/report-insights.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {GroupTable, groupSum} from "@/components/reports/group-table.tsx";

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start") || params.get("start");
  const endDate = params.get("end") || params.get("end");
  return {startDate, endDate};
};

export const ActivityReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [rows, setRows] = useState<Tracking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(parseFilters, []);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} to ${filters.endDate}` : undefined;

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  const fetchData = useCallback(async () => {
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
          SELECT * FROM ${Tables.tracking}
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
          ORDER BY created_at DESC
        `;
      const [result] = await queryRef.current(query, params);
      setRows((result || []) as Tracking[]);
    } catch (err) {
      console.error("Failed to load activity report", err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [filters.endDate, filters.startDate, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const hasManager = (row: Tracking) => {
    const v = displayValue(row.manager);
    return Boolean(v && v !== '-');
  };
  const byUser = useMemo(() => groupSum(rows, (r) => String(r.user || '-'), () => 0), [rows]);
  const byModule = useMemo(() => groupSum(rows, (r) => r.module || '-', () => 0), [rows]);
  const byManager = useMemo(() => groupSum(rows.filter(hasManager), (r) => displayValue(r.manager), () => 0), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const approvals = rows.filter(hasManager).length;

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (rows.length === 0) return out;
    const pct = (n: number) => Math.round((n / rows.length) * 100);
    if (byUser[0]) out.push({id: 'top-user', severity: 'info', text: t('insights.activity.topUser', {name: byUser[0].name, count: byUser[0].count, pct: pct(byUser[0].count)})});
    if (byModule[0]) out.push({id: 'top-module', severity: 'info', text: t('insights.activity.topModule', {module: byModule[0].name, count: byModule[0].count})});
    if (approvals > 0) {
      out.push({id: 'approvals', severity: 'info', text: t('insights.activity.approvals', {count: approvals, pct: pct(approvals), name: byManager[0]?.name ?? '—', managerCount: byManager[0]?.count ?? 0})});
    }
    return out;
  }, [rows, byUser, byModule, byManager, approvals, t]);

  if (loading) {
    return <ReportsLayout title={t('titles.activity')} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.activity')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={t('titles.activity')} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  const columns: ReportColumn<Tracking>[] = [
    {key: 'time', header: t('common:actions.time'), sortValue: (r) => toLuxonDateTime(r.created_at as never).toMillis(), render: (r) => toLuxonDateTime(r.created_at as never).toFormat("yyyy-LL-dd HH:mm:ss")},
    {key: 'user', header: t('filters.user'), sortValue: (r) => String(r.user || ''), searchValue: (r) => String(r.user || ''), render: (r) => String(r.user || "-")},
    {key: 'role', header: t('columns.role'), searchValue: (r) => String(r.user_role || ''), render: (r) => String(r.user_role || "-")},
    {key: 'shift', header: t('filters.shift'), render: (r) => String(r.user_shift || "-")},
    {key: 'module', header: t('columns.module'), sortValue: (r) => r.module || '', searchValue: (r) => r.module || '', render: (r) => r.module || "-"},
    {key: 'page', header: t('common:table.page'), searchValue: (r) => r.page || '', render: (r) => r.page || "-"},
    {key: 'auth', header: t('columns.authMethod'), render: (r) => r.auth_method || "-"},
    {key: 'manager', header: t('filters.managers'), sortValue: (r) => displayValue(r.manager), searchValue: (r) => displayValue(r.manager), render: (r) => displayValue(r.manager)},
    {key: 'managerRole', header: t('columns.managerRole'), render: (r) => displayValue(r.manager_role)},
    {key: 'details', header: t('columns.details'), searchValue: (r) => displayValue(r.payload), render: (r) => displayValue(r.payload), cellClass: () => 'whitespace-normal max-w-[280px] break-all'},
    {key: 'device', header: t('columns.device'), render: (r) => (
      <>
        <div>{detectBrowser(r.user_agent)} / {detectOS(r.user_agent)}</div>
        <div className="text-neutral-500">{r.resolution || "-"}</div>
      </>
    )},
  ];

  const kpis: ReportKpi[] = [
    {label: t('activityReport.actions'), value: String(rows.length), rawValue: rows.length, rawFormat: 'integer'},
    {label: t('activityReport.users'), value: String(byUser.length), rawValue: byUser.length, rawFormat: 'integer'},
    {label: t('activityReport.approvals'), value: String(approvals), rawValue: approvals, rawFormat: 'integer', hint: t('activityReport.approvalsHint')},
    {label: t('activityReport.modules'), value: String(byModule.length), rawValue: byModule.length, rawFormat: 'integer'},
  ];

  return (
    <ReportsLayout
      title={t('titles.activity')}
      subtitle={subtitle}
      onRefresh={fetchData}
    >
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      {rows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-x-6">
          <GroupTable title={t('activityReport.byUser')} nameHeader={t('filters.user')} rows={byUser} showAmount={false}/>
          <GroupTable title={t('activityReport.byModule')} nameHeader={t('columns.module')} rows={byModule} showAmount={false}/>
          {byManager.length > 0 && <GroupTable title={t('activityReport.byManager')} nameHeader={t('filters.managers')} rows={byManager} showAmount={false}/>}
        </div>
      )}
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('activityReport.detail')}</h2>
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.id)}
        initialSort={{key: 'time', dir: 'desc'}}
        searchPlaceholder={t('activityReport.search')}
        emptyText={t('empty.noActivityLogs')}
        xlsxTitle={t('activityReport.detail')}
      />
    </ReportsLayout>
  );
};
