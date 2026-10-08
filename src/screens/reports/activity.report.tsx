import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Tracking} from "@/api/model/tracking.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import i18n from '@/lib/i18n.ts';

const tr = (key: string) => i18n.t(`reports:activity.${key}`);

export const detectBrowser = (userAgent?: string) => {
  if (!userAgent) return "-";
  const ua = userAgent.toLowerCase();

  if (ua.includes("edg/")) return tr('edge');
  if (ua.includes("opr/") || ua.includes("opera/")) return tr('opera');
  if (ua.includes("chrome/") && !ua.includes("edg/") && !ua.includes("opr/")) return tr('chrome');
  if (ua.includes("firefox/")) return tr('firefox');
  if (ua.includes("safari/") && !ua.includes("chrome/")) return tr('safari');
  return tr('unknownBrowser');
};

export const detectOS = (userAgent?: string) => {
  if (!userAgent) return "-";
  const ua = userAgent.toLowerCase();

  if (ua.includes("windows")) return tr('windows');
  if (ua.includes("android")) return tr('android');
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return tr('ios');
  if (ua.includes("mac os x") || ua.includes("macintosh")) return tr('macos');
  if (ua.includes("linux")) return tr('linux');
  return tr('unknownOs');
};

export const displayValue = (value?: unknown) => {
  if (value === undefined || value === null) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

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
  };

  useEffect(() => {
    void fetchData();
  }, [filters.endDate, filters.startDate]);

  if (loading) {
    return <ReportsLayout title={t('titles.activity')} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.activity')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={t('titles.activity')} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  return (
    <ReportsLayout
      title={t('titles.activity')}
      subtitle={subtitle}
      onRefresh={fetchData}
    >
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
          <tr>
            <th className="py-3 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">{t('common:actions.time')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('filters.user')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('columns.role')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('filters.shift')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('columns.module')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('common:table.page')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('columns.authMethod')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('filters.managers')}</th>
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('columns.managerRole')}</th>
            {/* <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">Coords</th> */}
            <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">{t('columns.details')}</th>
            <th className="py-3 pr-6 text-left text-sm font-semibold text-neutral-700">{t('columns.device')}</th>
          </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={12} className="py-6 text-center text-sm text-neutral-500">{t('empty.noActivityLogs')}</td>
            </tr>
          ) : rows.map((row) => (
            <tr key={row.id}>
              <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">{toLuxonDateTime(row.created_at as any).toFormat("yyyy-LL-dd HH:mm:ss")}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{String(row.user || "-")}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{String(row.user_role || "-")}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{String(row.user_shift || "-")}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{row.module || "-"}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{row.page || "-"}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{row.auth_method || "-"}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{displayValue(row.manager)}</td>
              <td className="py-3 px-3 text-sm text-neutral-700">{displayValue(row.manager_role)}</td>
              {/* <td className="py-3 px-3 text-xs text-neutral-700 max-w-[220px] break-all">{displayValue(row.coords)}</td> */}
              <td className="py-3 px-3 text-sm text-neutral-700 max-w-[280px] break-all">{displayValue(row.payload)}</td>
              <td className="py-3 pr-6 text-sm text-neutral-700">
                <div>{detectBrowser(row.user_agent)} / {detectOS(row.user_agent)}</div>
                <div className="sm text-neutral-500">{row.resolution || "-"}</div>
                {/*<div className="text-xs text-neutral-500 max-w-[320px] break-all">{row.user_agent || "-"}</div>*/}
              </td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </ReportsLayout>
  );
};
