import type { Dish } from '@/api/model/dish.ts';

/** Case- and accent-insensitive form for matching (NFD + strip combining marks). */
const normalizeSearch = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const tokenize = (value: string): string[] => value.split(/[^a-z0-9]+/).filter(Boolean);

/** Typos allowed for a query word: short words must match exactly. */
const allowedTypos = (word: string): number => {
  if (word.length < 4) return 0;
  if (word.length < 8) return 1;
  return 2;
};

/** Edit distance counting a swap of two neighbouring letters as one typo. */
const editDistance = (a: string, b: string): number => {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
};

/**
 * Typos between a query word and the start of a name token ("poulte" ~ "poulet",
 * "cocq" ~ "coca-cola"). Infinity when over the allowance for that word.
 */
const fuzzyWordDistance = (word: string, tokens: string[]): number => {
  const allowed = allowedTypos(word);
  if (allowed === 0) return Infinity;

  let best = Infinity;
  for (const token of tokens) {
    for (let length = word.length - 1; length <= word.length + 1; length++) {
      if (length < 1 || length > token.length) continue;
      best = Math.min(best, editDistance(word, token.slice(0, length)));
    }
  }
  return best <= allowed ? best : Infinity;
};

/**
 * Filter dishes by a free-text query.
 * Empty / whitespace-only query returns the input list unchanged.
 * Match: every query word in the name (a mistyped word still matches the start of
 * a name word), OR number starts with the query, OR a category name contains the
 * query. Accent- and case-insensitive.
 * Order: number matches, then name-starts-with, then other exact matches, then
 * mistyped ones (fewest typos first); stable otherwise.
 */
export function searchDishes(dishes: Dish[], query: string): Dish[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return dishes;
  }

  const normalizedQuery = normalizeSearch(trimmed);
  const words = normalizedQuery.split(/\s+/).filter(Boolean);

  const matched: { dish: Dish; rank: number; typos: number; index: number }[] = [];

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

    if (numberMatch || nameWordsMatch || categoryMatch) {
      let rank = 2;
      if (numberMatch) {
        rank = 0;
      } else if (name.startsWith(normalizedQuery)) {
        rank = 1;
      }
      matched.push({ dish, rank, typos: 0, index });
      return;
    }

    const tokens = tokenize(name);
    let typos = 0;
    for (const word of words) {
      if (name.includes(word)) continue;
      typos += fuzzyWordDistance(word, tokens);
      if (typos === Infinity) return;
    }
    matched.push({ dish, rank: 3, typos, index });
  });

  matched.sort((a, b) => a.rank - b.rank || a.typos - b.typos || a.index - b.index);

  return matched.map((entry) => entry.dish);
}
