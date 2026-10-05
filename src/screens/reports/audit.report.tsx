import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import { getActivityLog } from '@/api/reports/operations/index.ts';
import { parseDateRangeFromParams } from '@/api/reports/shared/filters.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { detectBrowser, detectOS, displayValue } from '@/screens/reports/activity.report.tsx';

type AuditRow = Awaited<ReturnType<typeof getActivityLog>>['entries'][number];

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
      ? `${filters.startDate} to ${filters.endDate}`
      : undefined;

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await getActivityLog(db, {
        startDate: filters.startDate,
        endDate: filters.endDate,
        limit: 500,
      });
      setRows(result.entries);
    } catch (err) {
      console.error('Failed to load audit report', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
  }, [filters.startDate, filters.endDate]);

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
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <th className="py-3 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">
                {t('common:actions.time')}
              </th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('filters.user')}
              </th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('columns.module')}
              </th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('common:table.page')}
              </th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">Auth</th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">Payload</th>
              <th className="py-3 pr-6 text-left text-sm font-semibold text-neutral-700">
                {t('columns.device')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-neutral-500">
                  {t('empty.noActivity', { defaultValue: 'No audit entries for selected range.' })}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">
                    {row.createdAt
                      ? toLuxonDateTime(row.createdAt as never).toFormat('yyyy-LL-dd HH:mm:ss')
                      : '-'}
                  </td>
                  <td className="py-3 px-3 text-sm text-neutral-700">{row.userName || '-'}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700">{row.module || '-'}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700">{row.page || '-'}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700">{row.authMethod || '-'}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700 max-w-[280px] break-all">
                    {displayValue(row.payload)}
                  </td>
                  <td className="py-3 pr-6 text-sm text-neutral-700">
                    <div>
                      {detectBrowser(row.userAgent)} / {detectOS(row.userAgent)}
                    </div>
                    <div className="text-neutral-500">{row.resolution || '-'}</div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </ReportsLayout>
  );
};
