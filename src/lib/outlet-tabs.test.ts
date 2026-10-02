import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import type { Category } from '@/api/model/category.ts';
import { outletsInUse } from '@/lib/outlet-tabs.ts';

const bar = { id: 'outlet:bar', name: 'Bar', priority: 2 };
const resto = { id: 'outlet:restaurant', name: 'Restaurant', priority: 1 };

const category = (id: string, extra: Partial<Category> = {}) =>
  ({ id, name: id, priority: 0, ...extra }) as unknown as Category;

describe('outletsInUse', () => {
  it('returns outlets used by categories, sorted by priority', () => {
    const categories = [
      category('category:drinks', { outlet: bar as never }),
      category('category:mains', { outlet: resto as never }),
      category('category:beers', { parent: new RecordId('category', 'drinks') as never }),
    ];
    expect(outletsInUse(categories).map((o) => o.name)).toEqual(['Restaurant', 'Bar']);
  });

  it('is empty when no category has an outlet', () => {
    expect(outletsInUse([category('category:specials')])).toEqual([]);
  });

  it('dedupes the same outlet inherited by children', () => {
    const categories = [
      category('category:drinks', { outlet: bar as never }),
      category('category:beers', { parent: new RecordId('category', 'drinks') as never }),
    ];
    expect(outletsInUse(categories)).toHaveLength(1);
  });
});
