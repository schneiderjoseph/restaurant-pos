import type { Category } from '@/api/model/category.ts';
import type { Table } from '@/api/model/table.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';

/** Unset (null / NONE) counts as shown — only an explicit `false` hides a category. */
export const isCategoryShownInMenu = (category?: Pick<Category, 'show_in_menu'> | null): boolean =>
  category?.show_in_menu !== false;

/**
 * Narrows `all` to the ids in a table's own list; an empty or missing list means
 * no restriction. Rows come from `all` (the fresh cache), never from the table's
 * embedded copies, which can be stale.
 */
export function narrowToTableList<T extends { id?: unknown }>(all: T[], tableList?: { id?: unknown }[] | null): T[] {
  const ids = new Set(
    (tableList ?? []).map((row) => recordIdToString(row?.id ?? row)).filter(Boolean),
  );
  if (ids.size === 0) {
    return all ?? [];
  }
  return (all ?? []).filter((row) => ids.has(recordIdToString(row.id)));
}

/** Categories the menu may show: hidden ones dropped, then narrowed to the table's own list. */
export function menuCategoriesFor(categories: Category[], table?: Pick<Table, 'categories'> | null): Category[] {
  return narrowToTableList((categories ?? []).filter(isCategoryShownInMenu), table?.categories);
}
