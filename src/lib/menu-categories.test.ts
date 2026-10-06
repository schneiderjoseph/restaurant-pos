import { describe, expect, it } from 'vitest';
import { isCategoryShownInMenu, menuCategoriesFor, narrowToTableList } from '@/lib/menu-categories.ts';
import type { Category } from '@/api/model/category.ts';

const category = (id: string, show_in_menu?: boolean | null): Category =>
  ({ id, name: id, priority: 0, show_in_menu } as unknown as Category);

describe('isCategoryShownInMenu', () => {
  it('hides only an explicit false', () => {
    expect(isCategoryShownInMenu(category('a', true))).toBe(true);
    expect(isCategoryShownInMenu(category('a', null))).toBe(true);
    expect(isCategoryShownInMenu(category('a', undefined))).toBe(true);
    expect(isCategoryShownInMenu(category('a', false))).toBe(false);
  });
});

describe('menuCategoriesFor', () => {
  const all = [category('category:a', true), category('category:b', false), category('category:c', null)];

  it('drops hidden categories when the table has no list', () => {
    expect(menuCategoriesFor(all).map((c) => c.id)).toEqual(['category:a', 'category:c']);
    expect(menuCategoriesFor(all, { categories: [] }).map((c) => c.id)).toEqual(['category:a', 'category:c']);
  });

  it('narrows to the table list and still drops hidden ones', () => {
    // The table copy says b is shown, but the fresh cache says hidden — the cache wins.
    const table = { categories: [category('category:a', true), category('category:b', true)] };
    expect(menuCategoriesFor(all, table).map((c) => c.id)).toEqual(['category:a']);
  });

  it('leaves the input list untouched', () => {
    menuCategoriesFor(all, { categories: [category('category:a')] });
    expect(all).toHaveLength(3);
  });
});

describe('narrowToTableList', () => {
  const all = [{ id: 'order_type:dine', name: 'Dine in' }, { id: 'order_type:take', name: 'Take away' }];

  it('keeps everything when the table has no list', () => {
    expect(narrowToTableList(all, undefined)).toEqual(all);
    expect(narrowToTableList(all, [])).toEqual(all);
  });

  it('returns fresh rows for the table ids and drops unknown ones', () => {
    const table = [{ id: 'order_type:take', name: 'stale name' }, { id: 'order_type:gone' }];
    expect(narrowToTableList(all, table)).toEqual([{ id: 'order_type:take', name: 'Take away' }]);
  });
});
