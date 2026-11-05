import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import { listMenuItems, type MenuItemSummary } from '@/api/reports/sales/products.ts';
import { withCurrency } from '@/lib/utils.ts';
import { ReportKpis, type ReportKpi } from '@/components/reports/report-kpis.tsx';
import { ReportInsights, type ReportInsight } from '@/components/reports/report-insights.tsx';
import { SortableReportTable, type ReportColumn } from '@/components/reports/sortable-report-table.tsx';
import { GroupTable, groupSum } from '@/components/reports/group-table.tsx';
import { listNames } from '@/api/reports/insights/credit.ts';

export const ProductListReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const [rows, setRows] = useState<MenuItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const items = await listMenuItems(db, { limit: 5000 });
      setRows(items);
    } catch (err) {
      console.error('Failed to load product list report', err);
      setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
    } finally {
      setLoading(false);
    }
  }, [db, t]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const byCategory = useMemo(
    () => groupSum(rows, (r) => (r.categories.length ? r.categories : [t('expenseReport.uncategorized')]), (r) => Number(r.price) || 0),
    [rows, t],
  );

  const insights = useMemo((): ReportInsight[] => {
    const out: ReportInsight[] = [];
    if (rows.length === 0) return out;
    const tt = (k: string, p?: Record<string, unknown>) => String(t(k, p as never));
    const noPrice = rows.filter((r) => !(Number(r.price) > 0));
    if (noPrice.length) out.push({ id: 'no-price', severity: 'warn', text: t('insights.productList.noPrice', { count: noPrice.length, names: listNames(noPrice.map((r) => r.name), tt, 5) }) });
    const noCategory = rows.filter((r) => r.categories.length === 0);
    if (noCategory.length) out.push({ id: 'no-category', severity: 'warn', text: t('insights.productList.noCategory', { count: noCategory.length, names: listNames(noCategory.map((r) => r.name), tt, 5) }) });
    const noCode = rows.filter((r) => !r.number);
    if (noCode.length) out.push({ id: 'no-code', severity: 'info', text: t('insights.productList.noCode', { count: noCode.length }) });
    const dupes = (keyOf: (r: (typeof rows)[number]) => string) => {
      const seen = new Map<string, number>();
      rows.forEach((r) => { const k = keyOf(r); if (k) seen.set(k, (seen.get(k) ?? 0) + 1); });
      return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
    };
    const dupCodes = dupes((r) => String(r.number ?? '').trim());
    if (dupCodes.length) out.push({ id: 'dup-codes', severity: 'bad', text: t('insights.productList.duplicateCodes', { count: dupCodes.length, codes: listNames(dupCodes, tt, 8) }) });
    const dupNames = dupes((r) => r.name.trim().toLowerCase());
    if (dupNames.length) out.push({ id: 'dup-names', severity: 'warn', text: t('insights.productList.duplicateNames', { count: dupNames.length, names: listNames(dupNames, tt, 5) }) });
    if (out.length === 0) out.push({ id: 'ok', severity: 'good', text: t('insights.productList.allGood') });
    return out;
  }, [rows, t]);

  if (loading) {
    return (
      <ReportsLayout title={t('titles.productList')}>
        <div className="py-12 text-center text-neutral-500">{t('loading.report')}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={t('titles.productList')}>
        <div className="py-12 text-center text-red-600">
          {t('errors.failedToLoad', { error })}
        </div>
      </ReportsLayout>
    );
  }

  type Row = (typeof rows)[number];
  const prices = rows.map((r) => Number(r.price) || 0).filter((n) => n > 0);
  const avgPrice = prices.length ? prices.reduce((sum, n) => sum + n, 0) / prices.length : 0;
  const columns: ReportColumn<Row>[] = [
    { key: 'code', header: t('columns.itemCode'), sortValue: (r) => String(r.number ?? ''), searchValue: (r) => String(r.number ?? ''), render: (r) => r.number || '-' },
    { key: 'name', header: t('columns.itemName'), sortValue: (r) => r.name.toLowerCase(), searchValue: (r) => r.name, render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'category', header: t('columns.category'), sortValue: (r) => r.categories.join(', ').toLowerCase(), searchValue: (r) => r.categories.join(' '), render: (r) => (r.categories.length ? r.categories.join(', ') : <span className="text-amber-700">{t('expenseReport.uncategorized')}</span>) },
    { key: 'price', header: t('columns.price'), align: 'right', sortValue: (r) => Number(r.price) || 0, render: (r) => withCurrency(r.price), cellClass: (r) => (Number(r.price) > 0 ? '' : 'text-amber-700 font-semibold') },
  ];
  const kpis: ReportKpi[] = [
    { label: t('productListReport.items'), value: String(rows.length), rawValue: rows.length, rawFormat: 'integer' },
    { label: t('productListReport.categories'), value: String(byCategory.length), rawValue: byCategory.length, rawFormat: 'integer' },
    { label: t('productListReport.avgPrice'), value: withCurrency(avgPrice), rawValue: avgPrice },
    { label: t('productListReport.priceRange'), value: prices.length ? `${withCurrency(Math.min(...prices))} – ${withCurrency(Math.max(...prices))}` : '—' },
  ];

  return (
    <ReportsLayout title={t('titles.productList')} onRefresh={fetchData}>
      <ReportKpis items={kpis} />
      <ReportInsights items={insights} />
      <div className="max-w-2xl">
        <GroupTable title={t('productListReport.byCategory')} nameHeader={t('columns.category')} rows={byCategory} showAmount={false} countHeader={t('productListReport.items')} />
      </div>
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('productListReport.menu')}</h2>
      <SortableReportTable
        rows={rows}
        columns={columns}
        rowKey={(r) => String(r.id)}
        initialSort={{ key: 'name', dir: 'asc' }}
        searchPlaceholder={t('productListReport.search')}
        emptyText={t('empty.noProducts')}
        xlsxTitle={t('productListReport.menu')}
      />
    </ReportsLayout>
  );
};
