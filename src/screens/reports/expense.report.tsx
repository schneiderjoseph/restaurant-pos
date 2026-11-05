import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {toLuxonDateTime} from "@/lib/datetime.ts";
import {formatNumber, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {ReportInsights, type ReportInsight} from "@/components/reports/report-insights.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {GroupTable, groupSum} from "@/components/reports/group-table.tsx";

type ExpenseItem = {
  id?: string;
  description?: string;
  category?: string;
  amount?: number;
};

type ClosingExpenseRow = {
  id: string;
  date_from?: unknown;
  date_to?: unknown;
  expenses_data?: ExpenseItem[];
};

type FlattenedExpense = {
  closingId: string;
  dateFrom?: unknown;
  dateTo?: unknown;
  description: string;
  category: string;
  amount: number;
};

const parseFilters = () => {
  const params = new URLSearchParams(window.location.search);
  const startDate = params.get("start") || params.get("start");
  const endDate = params.get("end") || params.get("end");
  return {startDate, endDate};
};

export const ExpenseReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [rows, setRows] = useState<FlattenedExpense[]>([]);
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
          conditions.push(`time::format(date_from, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") >= $startDate`);
          params.startDate = filters.startDate;
        }
        if (filters.endDate) {
          conditions.push(`time::format(date_from, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") <= $endDate`);
          params.endDate = filters.endDate;
        }

        const query = `
          SELECT * FROM ${Tables.closings}
          ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
          ORDER BY date_from DESC
        `;
        const [result] = await queryRef.current(query, params);
        const closings = (result || []) as ClosingExpenseRow[];

        const flatRows = closings.flatMap((closing) => {
          const expenses = closing.expenses_data || [];
          return expenses.map((expense) => ({
            closingId: closing.id,
            dateFrom: closing.date_from,
            dateTo: closing.date_to,
            description: expense.description || "-",
            category: expense.category || "-",
            amount: Number(expense.amount || 0),
          }));
        });
        setRows(flatRows);
      } catch (err) {
        console.error("Failed to load expense report", err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [filters.endDate, filters.startDate, t]);

  const totalExpenses = useMemo(() => rows.reduce((sum, row) => sum + row.amount, 0), [rows]);
  const byCategory = useMemo(() => groupSum(rows, (r) => r.category || t('expenseReport.uncategorized'), (r) => r.amount), [rows, t]);
  const closings = useMemo(() => new Set(rows.map((r) => r.closingId)).size, [rows]);

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (rows.length === 0) return out;
    const pct = (part: number) => (totalExpenses > 0 ? Math.round((part / totalExpenses) * 100) : 0);
    if (byCategory[0]) {
      out.push({id: 'top-category', severity: 'info', text: t('insights.expenses.topCategory', {category: byCategory[0].name, amount: withCurrency(byCategory[0].amount), pct: pct(byCategory[0].amount)})});
    }
    const biggest = [...rows].sort((x, y) => y.amount - x.amount)[0];
    out.push({id: 'biggest', severity: 'info', text: t('insights.expenses.biggest', {description: biggest.description || '—', amount: withCurrency(biggest.amount), pct: pct(biggest.amount)})});
    const uncategorized = rows.filter((r) => !r.category);
    if (uncategorized.length) {
      out.push({id: 'uncategorized', severity: 'warn', text: t('insights.expenses.uncategorized', {count: uncategorized.length, amount: withCurrency(uncategorized.reduce((sum, r) => sum + r.amount, 0))})});
    }
    if (closings > 1) {
      out.push({id: 'per-closing', severity: 'info', text: t('insights.expenses.perClosing', {avg: withCurrency(totalExpenses / closings), count: closings})});
    }
    return out;
  }, [rows, byCategory, totalExpenses, closings, t]);

  if (loading) {
    return <ReportsLayout title={t('titles.expense')} subtitle={subtitle}><div className="py-12 text-center text-neutral-500">{t('loading.expense')}</div></ReportsLayout>;
  }
  if (error) {
    return <ReportsLayout title={t('titles.expense')} subtitle={subtitle}><div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div></ReportsLayout>;
  }

  type Row = (typeof rows)[number];
  const fmtWindow = (r: Row) => `${toLuxonDateTime(r.dateFrom as never).toFormat("yyyy-LL-dd HH:mm")} - ${toLuxonDateTime(r.dateTo as never).toFormat("yyyy-LL-dd HH:mm")}`;
  const columns: ReportColumn<Row>[] = [
    {key: 'window', header: t('metrics.dateWindow'), sortValue: (r) => toLuxonDateTime(r.dateFrom as never).toMillis(), render: fmtWindow, total: () => t('columns.total')},
    {key: 'description', header: t('columns.description'), sortValue: (r) => r.description.toLowerCase(), searchValue: (r) => r.description, render: (r) => r.description, cellClass: () => 'whitespace-normal'},
    {key: 'category', header: t('columns.category'), sortValue: (r) => r.category.toLowerCase(), searchValue: (r) => r.category, render: (r) => r.category || <span className="text-amber-700">{t('expenseReport.uncategorized')}</span>},
    {key: 'amount', header: t('columns.amount'), align: 'right', sortValue: (r) => r.amount, render: (r) => <span className="font-semibold">{withCurrency(r.amount)}</span>, total: (rs) => withCurrency(rs.reduce((sum, r) => sum + r.amount, 0))},
  ];

  const kpis: ReportKpi[] = [
    {label: t('labels.totalExpenses'), value: withDualCurrency(totalExpenses), rawValue: totalExpenses},
    {label: t('labels.expenseRows'), value: formatNumber(rows.length), rawValue: rows.length, rawFormat: 'integer'},
    {label: t('expenseReport.closings'), value: formatNumber(closings), rawValue: closings, rawFormat: 'integer'},
    {label: t('expenseReport.topCategory'), value: byCategory[0]?.name ?? '—', hint: byCategory[0] ? withCurrency(byCategory[0].amount) : undefined},
  ];

  return (
    <ReportsLayout title={t('titles.expense')} subtitle={subtitle}>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>
      {byCategory.length > 0 && (
        <div className="max-w-2xl">
          <GroupTable title={t('expenseReport.byCategory')} nameHeader={t('columns.category')} rows={byCategory}/>
        </div>
      )}
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('expenseReport.detail')}</h2>
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.closingId}-${r.description}-${r.amount}`}
        initialSort={{key: 'window', dir: 'asc'}}
        searchPlaceholder={t('expenseReport.search')}
        emptyText={t('empty.noExpenses')}
        xlsxTitle={t('expenseReport.detail')}
      />
    </ReportsLayout>
  );
};
