import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from "@/screens/partials/reports.layout.tsx";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import { withCurrency, withDualCurrency, toRecordId } from "@/lib/utils.ts";
import { ReportKpis, type ReportKpi } from "@/components/reports/report-kpis.tsx";
import { ReportInsights, type ReportInsight } from "@/components/reports/report-insights.tsx";
import { SortableReportTable, type ReportColumn } from "@/components/reports/sortable-report-table.tsx";

const normalizeId = (value: any): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "tb" in value && "id" in value) return `${value.tb}:${value.id}`;
  if (typeof value?.toString === "function") return value.toString();
  return String(value);
};

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start") || params.get("start");
  const endDate = params.get("end") || params.get("end");
  const shiftId = params.get("shift");
  return { startDate, endDate, shiftId };
};

export const TipsReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [distributions, setDistributions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shiftName, setShiftName] = useState<string>("");
  const filters = useMemo(parseFilters, []);

  const subtitle = useMemo(() => {
    const datePart = filters.startDate && filters.endDate
      ? `${filters.startDate} to ${filters.endDate}`
      : t('labels.allDates');
    const shiftPart = shiftName || t('labels.allShifts');
    return `${datePart} | ${shiftPart}`;
  }, [filters.startDate, filters.endDate, shiftName, t]);

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        if (filters.shiftId) {
          const [shiftRows] = await queryRef.current(`SELECT name FROM ${Tables.shifts} WHERE id = $id LIMIT 1`, { id: toRecordId(filters.shiftId) });
          setShiftName(shiftRows?.[0]?.name || t('labels.selectedShift'));
        } else {
          setShiftName(t('labels.allShifts'));
        }

        const conditions: string[] = [];
        const params: Record<string, any> = {};

        if (filters.startDate) {
          conditions.push(`time::format(from_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") >= $startDate`);
          params.startDate = filters.startDate;
        }
        if (filters.endDate) {
          conditions.push(`time::format(from_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") <= $endDate`);
          params.endDate = filters.endDate;
        }
        if (filters.shiftId) {
          conditions.push(`shift = $shiftId`);
          params.shiftId = toRecordId(filters.shiftId);
        }

        const query = `
          SELECT * FROM ${Tables.tip_distributions}
          ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
          FETCH shift, users, users.user
        `;

        const [rows] = await queryRef.current(query, params);
        setDistributions((rows || []) as any[]);
      } catch (err) {
        console.error("Failed to load tips report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [filters.startDate, filters.endDate, filters.shiftId]);

  const totalTips = useMemo(
    () => distributions.reduce((sum, distribution) => sum + safeNumber(distribution.total_tips), 0),
    [distributions]
  );
  const totalDistributions = distributions.length;

  const tipsByUser = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    distributions.forEach((distribution: any) => {
      (distribution.users || []).forEach((share: any) => {
        const user = share?.user;
        const userName = user
          ? `${user.first_name || ""} ${user.last_name || ""}`.trim() || t('voidsReport.unknown')
          : normalizeId(share?.user) || t('voidsReport.unknown');
        const row = map.get(userName) || { amount: 0, count: 0 };
        row.amount += safeNumber(share?.amount);
        row.count += 1;
        map.set(userName, row);
      });
    });
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
  }, [distributions, t]);

  type TipRow = (typeof tipsByUser)[number];
  const distributedTotal = tipsByUser.reduce((sum, r) => sum + r.amount, 0);
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (tipsByUser.length === 0) return out;
    const top = tipsByUser[0];
    out.push({ id: 'top', severity: 'info', text: t('insights.tips.top', { name: top.name, amount: withCurrency(top.amount), pct: pct(top.amount, distributedTotal) }) });
    if (tipsByUser.length >= 2) {
      const avg = distributedTotal / tipsByUser.length;
      out.push({ id: 'average', severity: 'info', text: t('insights.tips.average', { avg: withCurrency(avg), count: tipsByUser.length }) });
    }
    const gap = totalTips - distributedTotal;
    if (Math.abs(gap) > 0.5) {
      out.push({ id: 'gap', severity: 'warn', text: t('insights.tips.gap', { total: withCurrency(totalTips), distributed: withCurrency(distributedTotal), gap: withCurrency(gap) }) });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipsByUser, distributedTotal, totalTips, t]);

  if (loading) {
    return <ReportsLayout title={t('titles.tips')} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.tips')}</div></ReportsLayout>;
  }

  if (error) {
    return <ReportsLayout title={t('titles.tips')} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  const columns: ReportColumn<TipRow>[] = [
    { key: 'name', header: t('filters.user'), sortValue: (r) => r.name.toLowerCase(), searchValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span>, total: () => t('columns.total') },
    { key: 'count', header: t('tipsReport.distributions'), align: 'right', sortValue: (r) => r.count, render: (r) => r.count, total: (rs) => rs.reduce((sum, r) => sum + r.count, 0) },
    { key: 'amount', header: t('reports.tips'), align: 'right', sortValue: (r) => r.amount, render: (r) => withCurrency(r.amount), total: (rs) => withCurrency(rs.reduce((sum, r) => sum + r.amount, 0)) },
    { key: 'share', header: t('serverSales.share'), align: 'right', sortValue: (r) => r.amount, render: (r) => `${pct(r.amount, distributedTotal)} %` },
  ];

  const kpis: ReportKpi[] = [
    { label: t('metrics.totalTips'), value: withDualCurrency(totalTips), rawValue: totalTips },
    { label: t('metrics.savedDistributions'), value: String(totalDistributions), rawValue: totalDistributions, rawFormat: 'integer' },
    { label: t('tipsReport.beneficiaries'), value: String(tipsByUser.length), rawValue: tipsByUser.length, rawFormat: 'integer' },
    { label: t('tipsReport.averagePerPerson'), value: withCurrency(tipsByUser.length ? distributedTotal / tipsByUser.length : 0), rawValue: tipsByUser.length ? distributedTotal / tipsByUser.length : 0 },
  ];

  return (
    <ReportsLayout title={t('titles.tips')} subtitle={subtitle}>
      <ReportKpis items={kpis} />
      <ReportInsights items={insights} />
      <SortableReportTable
        rows={tipsByUser}
        columns={columns}
        rowKey={(r) => r.name}
        initialSort={{ key: 'amount', dir: 'desc' }}
        emptyText={t('empty.noTips')}
        xlsxTitle={t('tipsReport.byPerson')}
      />
    </ReportsLayout>
  );
};
