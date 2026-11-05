import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import { getActivityLog } from '@/api/reports/operations/index.ts';
import { parseDateRangeFromParams } from '@/api/reports/shared/filters.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { detectBrowser, detectOS, displayValue } from '@/screens/reports/activity.utils.ts';
import { ReportKpis, type ReportKpi } from '@/components/reports/report-kpis.tsx';
import { SortableReportTable, type ReportColumn } from '@/components/reports/sortable-report-table.tsx';
import { GroupTable, groupSum } from '@/components/reports/group-table.tsx';

type AuditRow = Awaited<ReturnType<typeof getActivityLog>>['entries'][number];

/** Rows loaded at most; the report says so when it hits it. */
const AUDIT_ROW_LIMIT = 500;

const parseFilters = () => parseDateRangeFromParams(new URLSearchParams(window.location.search));

export const AuditReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filters = useMemo(parseFilters, []);
  const subtitle =
    filters.startDate && filters.endDate
      ? `${filters.startDate} → ${filters.endDate}`
      : undefined;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getActivityLog(db, {
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: AUDIT_ROW_LIMIT,
      });
      setRows(result.entries);
    } catch (err) {
      console.error('Failed to load audit report', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, filters.endDate, filters.startDate, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const byUser = useMemo(() => groupSum(rows, (r) => r.userName || '-', () => 0), [rows]);
  const byModule = useMemo(() => groupSum(rows, (r) => r.module || '-', () => 0), [rows]);
  const columns: ReportColumn<AuditRow>[] = [
    { key: 'time', header: t('common:actions.time'), sortValue: (r) => (r.createdAt ? toLuxonDateTime(r.createdAt as never).toMillis() : 0), render: (r) => (r.createdAt ? toLuxonDateTime(r.createdAt as never).toFormat('yyyy-LL-dd HH:mm:ss') : '-') },
    { key: 'user', header: t('filters.user'), sortValue: (r) => r.userName || '', searchValue: (r) => r.userName || '', render: (r) => r.userName || '-' },
    { key: 'module', header: t('columns.module'), sortValue: (r) => r.module || '', searchValue: (r) => r.module || '', render: (r) => r.module || '-' },
    { key: 'page', header: t('common:table.page'), searchValue: (r) => r.page || '', render: (r) => r.page || '-' },
    { key: 'auth', header: t('columns.authMethod'), render: (r) => r.authMethod || '-' },
    { key: 'details', header: t('columns.details'), searchValue: (r) => displayValue(r.payload), render: (r) => displayValue(r.payload), cellClass: () => 'whitespace-normal max-w-[280px] break-all' },
    { key: 'device', header: t('columns.device'), render: (r) => (
      <>
        <div>{detectBrowser(r.userAgent)} / {detectOS(r.userAgent)}</div>
        <div className="text-neutral-500">{r.resolution || '-'}</div>
      </>
    ) },
  ];
  const kpis: ReportKpi[] = [
    { label: t('activityReport.actions'), value: String(rows.length), rawValue: rows.length, rawFormat: 'integer' },
    { label: t('activityReport.users'), value: String(byUser.length), rawValue: byUser.length, rawFormat: 'integer' },
    { label: t('activityReport.modules'), value: String(byModule.length), rawValue: byModule.length, rawFormat: 'integer' },
    { label: t('activityReport.mostActive'), value: byUser[0]?.name ?? '—', hint: byUser[0] ? t('activityReport.actionsCount', { count: byUser[0].count }) : undefined },
  ];

  if (loading) {
    return (
      <ReportsLayout title={t('titles.audit')} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('loading.report')}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={t('titles.audit')} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">
          {t('errors.failedToLoad', { error })}
        </div>
      </ReportsLayout>
    );
  }

  return (
    <ReportsLayout title={t('titles.audit')} subtitle={subtitle} onRefresh={fetchData}>
      {rows.length >= AUDIT_ROW_LIMIT && (
        <div className="mb-3 rounded-lg bg-warning-50 px-4 py-2 text-sm text-warning-800">
          {t('messages.auditTruncated', { count: AUDIT_ROW_LIMIT })}
        </div>
      )}
      <ReportKpis items={kpis} />
      {rows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
          <GroupTable title={t('activityReport.byUser')} nameHeader={t('filters.user')} rows={byUser} showAmount={false} />
          <GroupTable title={t('activityReport.byModule')} nameHeader={t('columns.module')} rows={byModule} showAmount={false} />
        </div>
      )}
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('activityReport.detail')}</h2>
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.id)}
        initialSort={{ key: 'time', dir: 'desc' }}
        searchPlaceholder={t('activityReport.search')}
        emptyText={t('empty.noActivity')}
        xlsxTitle={t('activityReport.detail')}
      />
    </ReportsLayout>
  );
};
