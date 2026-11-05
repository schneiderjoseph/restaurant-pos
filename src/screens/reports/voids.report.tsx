import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {ReportsLayout} from "@/screens/partials/reports.layout.tsx";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {OrderVoid} from "@/api/model/order_void.ts";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {formatNumber, withCurrency, withDualCurrency} from "@/lib/utils.ts";
import {ReportKpis, type ReportKpi} from "@/components/reports/report-kpis.tsx";
import {ReportInsights} from "@/components/reports/report-insights.tsx";
import {SortableReportTable, type ReportColumn} from "@/components/reports/sortable-report-table.tsx";
import {buildVoidInsights, type VoidGroupRow} from "@/api/reports/insights/voids.ts";
import { toLuxonDateTime } from "@/lib/datetime.ts";
import {
  getOrderItemDisplayLineTotal,
  getOrderItemModifierDisplayPrice,
} from "@/lib/order-item-display.ts";
import type { OrderItem } from "@/api/model/order_item.ts";
import { useShowInclusivePrices } from "@/hooks/useShowInclusivePrices.ts";
import {
  buildNestedRecordAnyCondition,
  buildRecordInsideCondition,
  buildStringInsideCondition,
} from "@/api/reports/shared/query.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";

const safeNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getVoidItems = (voidItem: OrderVoid) => (voidItem.items ?? []).filter(Boolean);

const getVoidLineAmount = (voidItem: OrderVoid, item: any, showInclusive = false) => {
  const quantity = safeNumber(voidItem.quantity ?? 1);
  const orderItem = {
    ...(item ?? {}),
    quantity,
  } as OrderItem;
  return safeNumber(
    showInclusive
      ? getOrderItemDisplayLineTotal(orderItem, true)
      : calculateOrderItemPrice(orderItem),
  );
};

interface VoidModifierDetail {
  name: string;
  quantity: number;
  price: number;
  depth: number;
}

const getVoidItemModifiers = (
  voidItem: OrderVoid,
  item: any,
  showInclusive = false,
): VoidModifierDetail[] => {
  const parentQuantity = safeNumber(voidItem.quantity ?? 1);
  const parentItem = {
    ...(item ?? {}),
    quantity: parentQuantity,
  } as OrderItem;
  const rows: VoidModifierDetail[] = [];

  const walkGroups = (groups: any[] = [], depth = 1) => {
    groups.forEach(group => {
      (group?.selectedModifiers ?? []).forEach((selected: any) => {
        const name = selected?.dish?.name || selected?.name || 'Modifier';
        const quantity = safeNumber(selected?.quantity || 1) * parentQuantity;
        const price = getOrderItemModifierDisplayPrice(
          safeNumber(selected?.price),
          parentItem,
          showInclusive,
        );
        rows.push({
          name,
          quantity,
          price,
          depth,
        });
        walkGroups(selected?.selectedGroups ?? [], depth + 1);
      });
    });
  };

  walkGroups(item?.modifiers ?? [], 1);
  return rows;
};

const recordToString = (value: any): string => recordIdToString(value);

interface ReportFilters {
  startDate?: string | null;
  endDate?: string | null;
  reasonIds: string[];
  managerIds: string[];
  cashierIds: string[];
  menuItemIds: string[];
}

const parseFilters = (): ReportFilters => {
  const params = new URLSearchParams(window.location.search);
  const parseMulti = (name: string) => {
    const list = [
      ...params.getAll(`${name}[]`),
      ...params.getAll(name),
    ].filter(Boolean);
    return list as string[];
  };

  return {
    startDate: params.get('start') || params.get('start'),
    endDate: params.get('end') || params.get('end'),
    reasonIds: parseMulti('reasons'),
    managerIds: parseMulti('managers'),
    cashierIds: parseMulti('cashiers'),
    menuItemIds: parseMulti('menu_items'),
  };
};

export const VoidsReport = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const { enabled: showInclusive } = useShowInclusivePrices();
  const queryRef = useRef(db.query);
  const [orderVoids, setOrderVoids] = useState<OrderVoid[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filters = useMemo(parseFilters, []);
  const subtitle = filters.startDate && filters.endDate ? `${filters.startDate} → ${filters.endDate}` : undefined;

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const conditions: string[] = [];
        const params: Record<string, any> = {};

        if (filters.startDate) {
          conditions.push(`time::format(created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") >= $startDate`);
          params.startDate = filters.startDate;
        }

        if (filters.endDate) {
          conditions.push(`time::format(created_at, "${import.meta.env.VITE_DB_DATABASE_FORMAT}") <= $endDate`);
          params.endDate = filters.endDate;
        }

        const reasonFilter = buildStringInsideCondition('reason', filters.reasonIds, 'reasonIds');
        if (reasonFilter.condition) {
          conditions.push(reasonFilter.condition);
          Object.assign(params, reasonFilter.params);
        }

        const managerFilter = buildRecordInsideCondition('deleted_by', filters.managerIds, 'managerIds');
        if (managerFilter.condition) {
          conditions.push(managerFilter.condition);
          Object.assign(params, managerFilter.params);
        }

        const cashierFilter = buildRecordInsideCondition('order.cashier', filters.cashierIds, 'cashierIds');
        if (cashierFilter.condition) {
          conditions.push(cashierFilter.condition);
          Object.assign(params, cashierFilter.params);
        }

        const menuItemFilter = buildNestedRecordAnyCondition('items.item', filters.menuItemIds, 'menuItem');
        if (menuItemFilter.condition) {
          conditions.push(menuItemFilter.condition);
          Object.assign(params, menuItemFilter.params);
        }

        const query = `
          SELECT * FROM ${Tables.order_voids}
          ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
          order by created_at ASC
          FETCH deleted_by, order, order.cashier, items, items.item, items.taxes, items.tax_mode, items.modifiers
        `;

        const result: any = await queryRef.current(query, params);
        setOrderVoids((result?.[0] ?? []) as OrderVoid[]);
      } catch (err) {
        console.error('Failed to load voids report:', err);
        setError(err instanceof Error ? err.message : t('errors.unableToLoad'));
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [filters.startDate, filters.endDate, filters.reasonIds, filters.managerIds, filters.cashierIds, filters.menuItemIds]);

  const personName = (user?: { first_name?: string; last_name?: string; login?: string } | null) =>
    user ? (`${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.login || t('voidsReport.unknown')) : t('voidsReport.unknown');

  /** One row per void with everything the tables and rules need. */
  const lines = useMemo(() => orderVoids.map((voidItem) => {
    const voidItems = getVoidItems(voidItem);
    const date = toLuxonDateTime(voidItem.created_at);
    return {
      id: recordToString(voidItem.id),
      voidItem,
      at: date.toMillis(),
      dateStr: date.toFormat(import.meta.env.VITE_DATE_FORMAT),
      timeStr: date.toFormat(import.meta.env.VITE_TIME_FORMAT),
      reason: voidItem.reason || t('voidsReport.unknown'),
      manager: personName(voidItem.deleted_by as never),
      cashier: voidItem.order?.cashier ? personName(voidItem.order.cashier as never) : t('voidsReport.unknown'),
      itemNames: voidItems.map((item) => item?.item?.name || t('voidsReport.unknown')),
      quantity: safeNumber(voidItem.quantity ?? 1),
      amount: voidItems.reduce((sum, item) => sum + getVoidLineAmount(voidItem, item), 0),
      displayAmount: voidItems.reduce((sum, item) => sum + getVoidLineAmount(voidItem, item, showInclusive), 0),
      orderNumber: String(voidItem.order?.invoice_number ?? '—'),
      comments: voidItem.comments || '',
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [orderVoids, showInclusive, t]);

  const groupBy = (keyOf: (l: (typeof lines)[number]) => string[]) => {
    const map = new Map<string, VoidGroupRow>();
    lines.forEach((l) => {
      keyOf(l).forEach((name) => {
        const row = map.get(name) ?? {name, count: 0, quantity: 0, amount: 0};
        row.count += 1;
        row.quantity += l.quantity;
        row.amount += l.amount;
        map.set(name, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.count - a.count);
  };

  const byReason = useMemo(() => groupBy((l) => [l.reason]), [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const byManager = useMemo(() => groupBy((l) => [l.manager]), [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const byCashier = useMemo(() => groupBy((l) => [l.cashier]), [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const byItem = useMemo(() => groupBy((l) => l.itemNames), [lines]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalAmount = lines.reduce((s, l) => s + l.amount, 0);
  const totalQuantity = lines.reduce((s, l) => s + l.quantity, 0);
  const withoutComment = lines.filter((l) => !l.comments.trim()).length;

  const insights = useMemo(() => buildVoidInsights(
    {count: lines.length, amount: totalAmount, byReason, byManager, byCashier, byItem, withoutComment},
    (k, p) => String(t(k, p as never)),
    (n) => withCurrency(n),
  ), [lines.length, totalAmount, byReason, byManager, byCashier, byItem, withoutComment, t]);

  const title = t('titles.voids');

  if (loading) {
    return (
      <ReportsLayout title={title} subtitle={subtitle}>
        <div className="py-12 text-center text-neutral-500">{t('loading.voids')}</div>
      </ReportsLayout>
    );
  }

  if (error) {
    return (
      <ReportsLayout title={title} subtitle={subtitle}>
        <div className="py-12 text-center text-red-600">{t('errors.failedToLoad', { error })}</div>
      </ReportsLayout>
    );
  }

  const topReason = byReason[0];
  const kpis: ReportKpi[] = [
    {label: t('voidsReport.amount'), value: withDualCurrency(totalAmount), rawValue: totalAmount, tone: lines.length ? 'warn' : 'good'},
    {label: t('voidsReport.count'), value: formatNumber(lines.length), rawValue: lines.length, rawFormat: 'integer', hint: t('voidsReport.itemsVoided', {count: totalQuantity})},
    {label: t('voidsReport.topReason'), value: topReason?.name ?? '—', hint: topReason ? withCurrency(topReason.amount) : undefined},
    {label: t('voidsReport.withoutComment'), value: formatNumber(withoutComment), rawValue: withoutComment, rawFormat: 'integer', tone: withoutComment > 0 ? 'warn' : 'good'},
  ];

  const groupColumns = (nameHeader: string): ReportColumn<VoidGroupRow>[] => [
    {key: 'name', header: nameHeader, sortValue: (r) => r.name.toLowerCase(), render: (r) => <span className="font-medium">{r.name}</span>, total: () => t('columns.total')},
    {key: 'count', header: t('metrics.count'), align: 'right', sortValue: (r) => r.count, render: (r) => formatNumber(r.count), total: (rs) => formatNumber(rs.reduce((s, r) => s + r.count, 0))},
    {key: 'quantity', header: t('columns.quantity'), align: 'right', sortValue: (r) => r.quantity, render: (r) => formatNumber(r.quantity), total: (rs) => formatNumber(rs.reduce((s, r) => s + r.quantity, 0))},
    {key: 'amount', header: t('columns.amount'), align: 'right', sortValue: (r) => r.amount, render: (r) => withCurrency(r.amount), total: (rs) => withCurrency(rs.reduce((s, r) => s + r.amount, 0))},
    {key: 'pct', header: '%', align: 'right', sortValue: (r) => r.amount, render: (r) => `${totalAmount > 0 ? Math.round((r.amount / totalAmount) * 100) : 0} %`},
  ];

  type Line = (typeof lines)[number];
  const detailColumns: ReportColumn<Line>[] = [
    {key: 'date', header: t('columns.date'), sortValue: (l) => l.at, render: (l) => l.dateStr, total: () => t('columns.total')},
    {key: 'time', header: t('common:actions.time'), render: (l) => l.timeStr},
    {key: 'reason', header: t('columns.reason'), sortValue: (l) => l.reason, searchValue: (l) => l.reason, render: (l) => l.reason},
    {
      key: 'items',
      header: t('voidsReport.menuItem'),
      searchValue: (l) => l.itemNames.join(' '),
      render: (l) => (
        <div className="space-y-1 whitespace-normal min-w-[12rem]">
          {getVoidItems(l.voidItem).map((item, itemIndex) => {
            const modifiers = getVoidItemModifiers(l.voidItem, item, showInclusive);
            return (
              <div key={`${l.id}-item-${itemIndex}`}>
                <div className="font-semibold text-neutral-900">{item?.item?.name || t('voidsReport.unknown')}</div>
                {modifiers.length > 0 && (
                  <div className="text-xs text-neutral-600">
                    {modifiers.map((m, i) => (
                      <div key={i} style={{marginLeft: `${Math.max(0, m.depth - 1) * 12}px`}}>
                        + {m.name} ×{formatNumber(m.quantity)} ({withCurrency(m.price)})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ),
    },
    {key: 'quantity', header: t('columns.quantity'), align: 'right', sortValue: (l) => l.quantity, render: (l) => formatNumber(l.quantity), total: (ls) => formatNumber(ls.reduce((s, l) => s + l.quantity, 0))},
    {key: 'amount', header: t('metrics.lineTotal'), align: 'right', sortValue: (l) => l.displayAmount, render: (l) => withCurrency(l.displayAmount), total: (ls) => withCurrency(ls.reduce((s, l) => s + l.displayAmount, 0))},
    {key: 'manager', header: t('voidsReport.manager'), sortValue: (l) => l.manager, searchValue: (l) => l.manager, render: (l) => l.manager},
    {key: 'cashier', header: t('metrics.cashier'), sortValue: (l) => l.cashier, searchValue: (l) => l.cashier, render: (l) => l.cashier},
    {key: 'order', header: t('voidsReport.orderNumber'), align: 'right', sortValue: (l) => l.orderNumber, searchValue: (l) => l.orderNumber, render: (l) => l.orderNumber},
    {
      key: 'comments',
      header: t('columns.comments'),
      searchValue: (l) => l.comments,
      render: (l) => l.comments || <span className="text-amber-700">{t('voidsReport.noComment')}</span>,
      cellClass: () => 'whitespace-normal',
    },
  ];

  return (
    <ReportsLayout title={title} subtitle={subtitle}>
      <ReportKpis items={kpis}/>
      <ReportInsights items={insights}/>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-6">
        <div>
          <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('voidsReport.byReason')}</h2>
          <SortableReportTable rows={byReason} columns={groupColumns(t('columns.reason'))} rowKey={(r) => r.name} xlsxTitle={t('voidsReport.byReason')}/>
        </div>
        <div>
          <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('voidsReport.byCashier')}</h2>
          <SortableReportTable rows={byCashier} columns={groupColumns(t('metrics.cashier'))} rowKey={(r) => r.name} xlsxTitle={t('voidsReport.byCashier')}/>
        </div>
        <div>
          <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('voidsReport.byManager')}</h2>
          <SortableReportTable rows={byManager} columns={groupColumns(t('voidsReport.manager'))} rowKey={(r) => r.name} xlsxTitle={t('voidsReport.byManager')}/>
        </div>
        <div>
          <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('voidsReport.byItem')}</h2>
          <SortableReportTable rows={byItem} columns={groupColumns(t('voidsReport.menuItem'))} rowKey={(r) => r.name} xlsxTitle={t('voidsReport.byItem')}/>
        </div>
      </div>

      <h2 className="text-base font-semibold text-neutral-800 mb-2">{t('voidsReport.detail')}</h2>
      <SortableReportTable
        rows={lines}
        columns={detailColumns}
        rowKey={(l) => l.id}
        initialSort={{key: 'date', dir: 'asc'}}
        searchPlaceholder={t('voidsReport.search')}
        emptyText={t('voidsReport.empty')}
        xlsxTitle={t('voidsReport.detail')}
      />
    </ReportsLayout>
  );
}
