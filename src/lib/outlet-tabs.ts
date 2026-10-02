import type { Category } from '@/api/model/category.ts';
import type { Outlet } from '@/api/model/outlet.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';
import { outletOfCategory } from '@/lib/outlet.ts';

/**
 * Points of sale used by at least one category (via inheritance), ordered by
 * priority. Empty when no category has an outlet — the menu then shows no tabs.
 */
export function outletsInUse(categories: Category[]): Outlet[] {
  const map = new Map<string, Outlet>();
  for (const category of categories) {
    const outlet = outletOfCategory(category.id, categories);
    if (!outlet || outlet.deleted_at) {
      continue;
    }
    map.set(recordIdToString(outlet.id), outlet);
  }
  return [...map.values()].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}
