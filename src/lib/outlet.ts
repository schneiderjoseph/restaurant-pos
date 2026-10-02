import type { Category } from '@/api/model/category.ts';
import type { Dish } from '@/api/model/dish.ts';
import type { Kitchen } from '@/api/model/kitchen.ts';
import type { Outlet } from '@/api/model/outlet.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';

/** An outlet is usable only once fetched: a bare record id has no name to copy onto a sale. */
const fetchedOutlet = (value: unknown): Outlet | undefined => {
  const outlet = value as Outlet | undefined;
  return outlet && typeof outlet === 'object' && typeof outlet.name === 'string' && outlet.id
    ? outlet
    : undefined;
};

const byId = (categories: Category[]) =>
  new Map(categories.map((category) => [recordIdToString(category.id), category]));

/** Outlet of a category, inherited from the closest ancestor that has one. */
export function outletOfCategory(
  categoryId: unknown,
  categories: Category[] | Map<string, Category>,
): Outlet | undefined {
  const map = categories instanceof Map ? categories : byId(categories);
  const visited = new Set<string>();
  let id = recordIdToString(categoryId);
  while (id && !visited.has(id)) {
    visited.add(id);
    const category = map.get(id);
    if (!category) {
      return undefined;
    }
    const outlet = fetchedOutlet(category.outlet);
    if (outlet) {
      return outlet;
    }
    id = recordIdToString(category.parent);
  }
  return undefined;
}

/**
 * Outlet an order line is sold under: the category it was picked from, else the dish's
 * own categories when they all agree. Undefined means "unclassified", never a guess.
 */
export function resolveOutlet(
  line: { category_id?: unknown; dish?: Pick<Dish, 'categories'> },
  categories: Category[],
): Outlet | undefined {
  const map = byId(categories);
  const picked = outletOfCategory(line.category_id, map);
  if (picked) {
    return picked;
  }

  const candidates = new Map<string, Outlet>();
  for (const category of line.dish?.categories ?? []) {
    const outlet = outletOfCategory(category?.id, map);
    if (!outlet) {
      return undefined;
    }
    candidates.set(recordIdToString(outlet.id), outlet);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : undefined;
}

/** The category and every category below it. */
function withDescendants(categoryId: string, categories: Category[]): Set<string> {
  const ids = new Set([categoryId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const category of categories) {
      const id = recordIdToString(category.id);
      if (!ids.has(id) && ids.has(recordIdToString(category.parent))) {
        ids.add(id);
        grew = true;
      }
    }
  }
  return ids;
}

/**
 * Outlet suggested for a category from the stations its dishes go to: the outlet of the
 * majority of its dishes (sub-categories included). No station, or a tie, suggests nothing —
 * a bottled drink with no station, or a mixed category, is left to the manager.
 */
export function suggestOutlet(
  categoryId: unknown,
  categories: Category[],
  dishes: Pick<Dish, 'id' | 'categories'>[],
  kitchens: Pick<Kitchen, 'items' | 'outlet'>[],
): Outlet | undefined {
  const scope = withDescendants(recordIdToString(categoryId), categories);
  const outletsByDish = new Map<string, Map<string, Outlet>>();
  for (const kitchen of kitchens) {
    const outlet = fetchedOutlet(kitchen.outlet);
    if (!outlet) continue;
    for (const item of kitchen.items ?? []) {
      const dishId = recordIdToString(item);
      const outlets = outletsByDish.get(dishId) ?? new Map<string, Outlet>();
      outlets.set(recordIdToString(outlet.id), outlet);
      outletsByDish.set(dishId, outlets);
    }
  }

  const votes = new Map<string, { outlet: Outlet; count: number }>();
  for (const dish of dishes) {
    const inScope = (dish.categories ?? []).some((category) => scope.has(recordIdToString(category?.id)));
    if (!inScope) continue;
    for (const [id, outlet] of outletsByDish.get(recordIdToString(dish.id)) ?? []) {
      const vote = votes.get(id) ?? { outlet, count: 0 };
      vote.count += 1;
      votes.set(id, vote);
    }
  }

  const ranked = [...votes.values()].sort((a, b) => b.count - a.count);
  if (ranked.length === 0 || (ranked.length > 1 && ranked[0].count === ranked[1].count)) {
    return undefined;
  }
  return ranked[0].outlet;
}
