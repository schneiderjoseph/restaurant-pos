import { describe, expect, it } from 'vitest';
import { searchDishes } from '@/lib/menu-search.ts';
import type { Dish } from '@/api/model/dish.ts';

const dish = (
  id: string,
  opts: {
    name?: string;
    number?: string;
    categories?: { id: string; name: string }[];
  } = {},
): Dish =>
  ({
    id: { toString: () => id },
    name: opts.name,
    number: opts.number as string,
    price: 0,
    categories: opts.categories?.map((category) => ({
      id: { toString: () => category.id },
      name: category.name,
    })),
  }) as Dish;

describe('searchDishes', () => {
  const creme = dish('d1', {
    name: 'Crème brûlée',
    number: '42',
    categories: [{ id: 'c1', name: 'Desserts' }],
  });
  const soup = dish('d2', {
    name: 'Tomato soup',
    number: '12',
    categories: [{ id: 'c2', name: 'Starters' }],
  });
  const steak = dish('d3', {
    name: 'Steak frites',
    number: '120',
    categories: [{ id: 'c3', name: 'Mains' }],
  });
  const noNumber = dish('d4', {
    name: 'House salad',
    categories: [{ id: 'c2', name: 'Starters' }],
  });
  const noCategories = dish('d5', {
    name: 'Espresso',
    number: '7',
  });

  const list = [creme, soup, steak, noNumber, noCategories];

  it('returns the input list unchanged for an empty or whitespace query', () => {
    expect(searchDishes(list, '')).toBe(list);
    expect(searchDishes(list, '   ')).toBe(list);
  });

  it('matches accent-insensitively on the name (creme → Crème brûlée)', () => {
    expect(searchDishes(list, 'creme')).toEqual([creme]);
    expect(searchDishes(list, 'CREME BRULEE')).toEqual([creme]);
  });

  it('requires every whitespace-separated word of the query in the name', () => {
    expect(searchDishes(list, 'steak frites')).toEqual([steak]);
    expect(searchDishes(list, 'steak soup')).toEqual([]);
  });

  it('matches when the dish number starts with the query', () => {
    expect(searchDishes(list, '12').map((item) => item.id.toString())).toEqual([
      'd2',
      'd3',
    ]);
  });

  it('matches when a category name contains the query', () => {
    expect(searchDishes(list, 'dess')).toEqual([creme]);
    expect(searchDishes(list, 'start').map((item) => item.id.toString())).toEqual([
      'd2',
      'd4',
    ]);
  });

  it('ranks number matches before name-starts-with before other matches (stable)', () => {
    const byCategory = dish('cat', {
      name: 'Bread',
      number: '4',
      categories: [{ id: 'c', name: '12 specials' }],
    });
    const byName = dish('n', { name: '12 herbs salad', number: '3' });
    const byNumberLong = dish('num2', { name: 'Water', number: '120' });
    const byNumber = dish('num', { name: 'Cola', number: '12' });

    const result = searchDishes(
      [byCategory, byName, byNumberLong, byNumber],
      '12',
    );
    expect(result.map((item) => item.id.toString())).toEqual([
      'num2',
      'num',
      'n',
      'cat',
    ]);
  });

  it('handles missing number and missing categories without throwing', () => {
    expect(searchDishes([noNumber, noCategories], 'salad')).toEqual([noNumber]);
    expect(searchDishes([noNumber, noCategories], '7')).toEqual([noCategories]);
    expect(searchDishes([noNumber], 'start')).toEqual([noNumber]);
    expect(searchDishes([noCategories], 'espresso')).toEqual([noCategories]);
  });
});
