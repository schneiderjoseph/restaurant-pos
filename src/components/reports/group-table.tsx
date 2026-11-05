import {useTranslation} from 'react-i18next';
import {formatNumber, withCurrency} from '@/lib/utils.ts';
import {SortableReportTable, type ReportColumn} from '@/components/reports/sortable-report-table.tsx';

export type GroupRow = { name: string; count: number; amount: number; quantity?: number };

/** Sum `amount` (and count lines) per key; a row may belong to several keys. */
export function groupSum<R>(
  rows: R[],
  keysOf: (row: R) => string | string[],
  amountOf: (row: R) => number,
  quantityOf?: (row: R) => number,
): GroupRow[] {
  const map = new Map<string, GroupRow>();
  for (const row of rows) {
    const keys = keysOf(row);
    for (const name of Array.isArray(keys) ? keys : [keys]) {
      const g = map.get(name) ?? {name, count: 0, amount: 0, ...(quantityOf ? {quantity: 0} : {})};
      g.count += 1;
      g.amount += amountOf(row);
      if (quantityOf) g.quantity = (g.quantity ?? 0) + quantityOf(row);
      map.set(name, g);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.count - a.count);
}

type Props = {
  title: string;
  nameHeader: string;
  rows: GroupRow[];
  countHeader?: string;
  amountHeader?: string;
  /** Hide the amount column for count-only groupings. */
  showAmount?: boolean;
  showQuantity?: boolean;
};

/** "By X" table: name, count, (quantity), amount and share, sortable with totals. */
export const GroupTable = ({title, nameHeader, rows, countHeader, amountHeader, showAmount = true, showQuantity = false}: Props) => {
  const {t} = useTranslation('reports');
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const totalCount = rows.reduce((s, r) => s + r.count, 0);
  const basis = showAmount ? totalAmount : totalCount;
  const pct = (r: GroupRow) => {
    const v = showAmount ? r.amount : r.count;
    return `${basis > 0 ? Math.round((v / basis) * 100) : 0} %`;
  };
  const columns: ReportColumn<GroupRow>[] = [
    {key: 'name', header: nameHeader, sortValue: (r) => r.name.toLowerCase(), render: (r) => <span className="font-medium">{r.name}</span>, total: () => t('columns.total')},
    {key: 'count', header: countHeader ?? t('metrics.count'), align: 'right', sortValue: (r) => r.count, render: (r) => formatNumber(r.count), total: (rs) => formatNumber(rs.reduce((s, r) => s + r.count, 0))},
    ...(showQuantity ? [{key: 'quantity', header: t('columns.quantity'), align: 'right' as const, sortValue: (r: GroupRow) => r.quantity ?? 0, render: (r: GroupRow) => formatNumber(r.quantity ?? 0), total: (rs: GroupRow[]) => formatNumber(rs.reduce((s, r) => s + (r.quantity ?? 0), 0))}] : []),
    ...(showAmount ? [{key: 'amount', header: amountHeader ?? t('columns.amount'), align: 'right' as const, sortValue: (r: GroupRow) => r.amount, render: (r: GroupRow) => withCurrency(r.amount), total: (rs: GroupRow[]) => withCurrency(rs.reduce((s, r) => s + r.amount, 0))}] : []),
    {key: 'pct', header: '%', align: 'right', sortValue: (r) => (showAmount ? r.amount : r.count), render: pct},
  ];
  return (
    <div>
      <h2 className="text-base font-semibold text-neutral-800 mb-2">{title}</h2>
      <SortableReportTable rows={rows} columns={columns} rowKey={(r) => r.name} xlsxTitle={title} />
    </div>
  );
};
