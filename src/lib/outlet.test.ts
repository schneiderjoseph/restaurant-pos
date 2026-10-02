import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import type { Category } from '@/api/model/category.ts';
import type { Dish } from '@/api/model/dish.ts';
import type { Kitchen } from '@/api/model/kitchen.ts';
import { outletOfCategory, resolveOutlet, suggestOutlet } from '@/lib/outlet.ts';

const bar = { id: 'outlet:bar', name: 'Bar', priority: 1 };
const resto = { id: 'outlet:restaurant', name: 'Restaurant', priority: 2 };

const category = (id: string, extra: Partial<Category> = {}) =>
  ({ id, name: id, priority: 0, ...extra }) as unknown as Category;

const drinks = category('category:drinks', { outlet: bar as never });
const beers = category('category:beers', { parent: new RecordId('category', 'drinks') as never });
const mains = category('category:mains', { outlet: resto as never });
const specials = category('category:specials');
const categories = [drinks, beers, mains, specials];

const dish = (id: string, ...cats: Category[]) =>
  ({ id, categories: cats }) as unknown as Dish;

describe('outletOfCategory', () => {
  it('inherits the outlet of a parent category', () => {
    expect(outletOfCategory('category:beers', categories)?.name).toBe('Bar');
  });

  it('is undefined for a category with no outlet up its tree', () => {
    expect(outletOfCategory('category:specials', categories)).toBeUndefined();
  });

  it('ignores an outlet that was not fetched (no name to copy)', () => {
    const unfetched = category('category:x', { outlet: new RecordId('outlet', 'bar') as never });
    expect(outletOfCategory('category:x', [unfetched])).toBeUndefined();
  });

  it('treats a deleted outlet as none and falls back to the parent', () => {
    const closed = { ...bar, id: 'outlet:pool-bar', deleted_at: '2026-10-01T00:00:00Z' };
    const poolDrinks = category('category:pool', { outlet: closed as never, parent: new RecordId('category', 'mains') as never });
    expect(outletOfCategory('category:pool', [...categories, poolDrinks])?.name).toBe('Restaurant');
  });

  it('stops on a parent cycle', () => {
    const a = category('category:a', { parent: new RecordId('category', 'b') as never });
    const b = category('category:b', { parent: new RecordId('category', 'a') as never });
    expect(outletOfCategory('category:a', [a, b])).toBeUndefined();
  });
});

describe('resolveOutlet', () => {
  it('uses the category the dish was picked from', () => {
    const line = { category_id: 'category:beers', dish: dish('menu_item:prestige', beers, mains) };
    expect(resolveOutlet(line, categories)?.name).toBe('Bar');
  });

  it('falls back to the dish categories when they agree (picked from search)', () => {
    const line = { dish: dish('menu_item:prestige', beers, drinks) };
    expect(resolveOutlet(line, categories)?.name).toBe('Bar');
  });

  it('leaves the line unclassified when the dish categories disagree', () => {
    const line = { dish: dish('menu_item:mojito', drinks, mains) };
    expect(resolveOutlet(line, categories)).toBeUndefined();
  });

  it('leaves the line unclassified when one of its categories has no outlet', () => {
    const line = { dish: dish('menu_item:plat-du-jour', mains, specials) };
    expect(resolveOutlet(line, categories)).toBeUndefined();
  });
});

describe('suggestOutlet', () => {
  const barStation = { items: [], outlet: bar } as unknown as Kitchen;
  const kitchen = { items: [], outlet: resto } as unknown as Kitchen;

  it('suggests the outlet most of the dishes are prepared in, sub-categories included', () => {
    const dishes = [
      dish('menu_item:prestige', beers),
      dish('menu_item:mojito', drinks),
      dish('menu_item:planteur', drinks),
    ];
    const kitchens = [
      { ...barStation, items: ['menu_item:prestige', 'menu_item:mojito'] },
      { ...kitchen, items: ['menu_item:planteur'] },
    ] as unknown as Kitchen[];
    expect(suggestOutlet('category:drinks', categories, dishes, kitchens)?.name).toBe('Bar');
  });

  it('suggests nothing on a tie', () => {
    const dishes = [dish('menu_item:a', specials), dish('menu_item:b', specials)];
    const kitchens = [
      { ...barStation, items: ['menu_item:a'] },
      { ...kitchen, items: ['menu_item:b'] },
    ] as unknown as Kitchen[];
    expect(suggestOutlet('category:specials', categories, dishes, kitchens)).toBeUndefined();
  });

  it('suggests nothing when no dish goes to a station with an outlet (bottled drinks)', () => {
    const dishes = [dish('menu_item:water', specials)];
    expect(suggestOutlet('category:specials', categories, dishes, [barStation])).toBeUndefined();
  });

  it('reads station items given as fetched dishes', () => {
    const dishes = [dish('menu_item:griot', mains)];
    const kitchens = [{ ...kitchen, items: [{ id: new RecordId('menu_item', 'griot') }] }] as unknown as Kitchen[];
    expect(suggestOutlet('category:mains', categories, dishes, kitchens)?.name).toBe('Restaurant');
  });
});
