import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReportsLayout } from '@/screens/partials/reports.layout.tsx';
import { useDB } from '@/api/db/db.ts';
import { listMenuItems, type MenuItemSummary } from '@/api/reports/sales/products.ts';
import { withDualCurrency } from '@/lib/utils.ts';

export const ProductListReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const [rows, setRows] = useState<MenuItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
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
  };

  useEffect(() => {
    void fetchData();
  }, []);

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

  return (
    <ReportsLayout title={t('titles.productList')} onRefresh={fetchData}>
      <div className="overflow-hidden rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200">
          <thead className="bg-neutral-50">
            <tr>
              <th className="py-3 pl-6 pr-3 text-left text-sm font-semibold text-neutral-700">#</th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('columns.itemCode')}
              </th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('columns.itemName')}
              </th>
              <th className="py-3 px-3 text-left text-sm font-semibold text-neutral-700">
                {t('columns.category')}
              </th>
              <th className="py-3 pr-6 text-right text-sm font-semibold text-neutral-700">
                {t('columns.price')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-6 text-center text-sm text-neutral-500">
                  {t('empty.noProducts')}
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <tr key={row.id}>
                  <td className="py-3 pl-6 pr-3 text-sm text-neutral-900">{index + 1}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700">{row.number || '-'}</td>
                  <td className="py-3 px-3 text-sm text-neutral-900">{row.name}</td>
                  <td className="py-3 px-3 text-sm text-neutral-700">
                    {row.categories.length ? row.categories.join(', ') : '-'}
                  </td>
                  <td className="py-3 pr-6 text-sm text-neutral-900 text-right">
                    {withDualCurrency(row.price)}
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
