import {type ReactNode, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faSort, faSortDown, faSortUp, faMagnifyingGlass} from '@fortawesome/free-solid-svg-icons';
import {cn} from '@/lib/utils.ts';

export type ReportColumn<Row> = {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Enables click-to-sort on the header. */
  sortValue?: (row: Row) => string | number;
  /** Text matched by the search box (only columns that define it are searched). */
  searchValue?: (row: Row) => string;
  /** Footer cell; when any column defines it, a totals row is rendered. */
  total?: (rows: Row[]) => ReactNode;
  cellClass?: (row: Row) => string | false | undefined;
};

type Props<Row> = {
  rows: Row[];
  columns: ReportColumn<Row>[];
  rowKey: (row: Row) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  searchPlaceholder?: string;
  emptyText?: ReactNode;
  rowTestId?: string;
  /** Section title used in the Excel export. */
  xlsxTitle?: string;
  className?: string;
};

/**
 * Report table with a search box, click-to-sort headers and an optional totals
 * row. Totals are computed on the filtered rows so they match what is shown
 * (and what gets exported).
 */
export function SortableReportTable<Row>({
  rows,
  columns,
  rowKey,
  initialSort,
  searchPlaceholder,
  emptyText,
  rowTestId,
  xlsxTitle,
  className,
}: Props<Row>) {
  const {t} = useTranslation('reports');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState(initialSort ?? null);
  const searchable = columns.some((c) => c.searchValue);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows;
    if (q) {
      list = rows.filter((r) =>
        columns.some((c) => c.searchValue && c.searchValue(r).toLowerCase().includes(q)),
      );
    }
    if (sort) {
      const col = columns.find((c) => c.key === sort.key);
      if (col?.sortValue) {
        const factor = sort.dir === 'asc' ? 1 : -1;
        list = [...list].sort((a, b) => {
          const va = col.sortValue!(a);
          const vb = col.sortValue!(b);
          if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
          return String(va).localeCompare(String(vb)) * factor;
        });
      }
    }
    return list;
  }, [rows, columns, query, sort]);

  // Duplicate keys (e.g. two identical expense lines) get a suffix so React keeps them apart.
  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    return visible.map((row) => {
      const base = rowKey(row);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      return n === 0 ? base : `${base}#${n}`;
    });
  }, [visible, rowKey]);

  const hasTotals = columns.some((c) => c.total);
  const alignClass = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return {key, dir: 'desc'};
      if (prev.dir === 'desc') return {key, dir: 'asc'};
      return null;
    });
  };

  return (
    <div className={cn('mb-5', className)}>
      {searchable && (
        <div className="mb-2 flex items-center gap-2 print:hidden" data-xlsx-ignore>
          <div className="relative w-full max-w-sm">
            <FontAwesomeIcon icon={faMagnifyingGlass} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder ?? t('table.search')}
              className="w-full rounded-lg border border-neutral-300 py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>
          {query && (
            <span className="text-xs text-neutral-500">
              {t('table.shownOf', {shown: visible.length, total: rows.length})}
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <table className="min-w-full divide-y divide-neutral-200" data-xlsx-title={xlsxTitle}>
          <thead className="bg-neutral-50">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    className={cn('py-3 px-3 text-sm font-semibold text-neutral-700 whitespace-nowrap', alignClass(c.align))}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={cn('inline-flex items-center gap-1 hover:text-primary-700', c.align === 'right' && 'flex-row-reverse')}
                      >
                        <span>{c.header}</span>
                        <FontAwesomeIcon
                          data-xlsx-ignore
                          icon={active ? (sort?.dir === 'asc' ? faSortUp : faSortDown) : faSort}
                          className={cn('text-xs', active ? 'text-primary-600' : 'text-neutral-300')}
                        />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 bg-white">
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-sm text-neutral-500">
                  {emptyText ?? t('table.empty')}
                </td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr key={keys[index]} data-testid={rowTestId} className="hover:bg-neutral-50">
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn('py-2.5 px-3 text-sm text-neutral-800 whitespace-nowrap', alignClass(c.align), c.cellClass?.(row))}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
          {hasTotals && visible.length > 0 && (
            <tfoot className="bg-neutral-100 font-semibold border-t-2 border-neutral-300">
              <tr>
                {columns.map((c) => (
                  <td key={c.key} className={cn('py-2.5 px-3 text-sm whitespace-nowrap', alignClass(c.align))}>
                    {c.total ? c.total(visible) : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
