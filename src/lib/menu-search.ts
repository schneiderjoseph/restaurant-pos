import type { Dish } from '@/api/model/dish.ts';

/** Case- and accent-insensitive form for matching (NFD + strip combining marks). */
const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

/**
 * Filter dishes by a free-text query.
 * Empty / whitespace-only query returns the input list unchanged.
 * Match: every query word in the name, OR number starts with the query,
 * OR a category name contains the query. Accent- and case-insensitive.
 * Order: number matches, then name-starts-with, then the rest (stable).
 */
export function searchDishes(dishes: Dish[], query: string): Dish[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return dishes;
  }

  const normalizedQuery = normalizeSearch(trimmed);
  const words = normalizedQuery.split(/\s+/).filter(Boolean);

  type Rank = 0 | 1 | 2;
  const matched: { dish: Dish; rank: Rank; index: number }[] = [];

  dishes.forEach((dish, index) => {
    const name = normalizeSearch(dish.name ?? '');
    const number = normalizeSearch(String(dish.number ?? '').trim());
    const categories = dish.categories ?? [];

    const numberMatch = number.length > 0 && number.startsWith(normalizedQuery);
    const nameWordsMatch =
      words.length > 0 && words.every((word) => name.includes(word));
    const categoryMatch = categories.some((category) =>
      normalizeSearch(category.name ?? '').includes(normalizedQuery),
    );

    if (!numberMatch && !nameWordsMatch && !categoryMatch) {
      return;
    }

    let rank: Rank = 2;
    if (numberMatch) {
      rank = 0;
    } else if (name.startsWith(normalizedQuery)) {
      rank = 1;
    }

    matched.push({ dish, rank, index });
  });

  matched.sort((a, b) => {
    if (a.rank !== b.rank) {
      return a.rank - b.rank;
    }
    return a.index - b.index;
  });

  return matched.map((entry) => entry.dish);
}
