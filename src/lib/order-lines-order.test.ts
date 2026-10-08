import { describe, expect, it } from 'vitest';
import { newestLinesFirst } from '@/lib/order.ts';

describe('newestLinesFirst', () => {
  const line = (id: string, created_at?: string) => ({ id, created_at });

  it('lists the latest send first and keeps a send\'s lines in order', () => {
    const lines = [
      line('fish', '2026-10-08T18:00:00Z'),
      line('rice', '2026-10-08T18:00:00Z'),
      line('ice', '2026-10-08T20:00:00Z'),
      line('soda', '2026-10-08T20:00:00Z'),
    ];
    expect(newestLinesFirst(lines).map(({ id }) => id)).toEqual(['ice', 'soda', 'fish', 'rice']);
  });

  it('puts a line with no send time last', () => {
    expect(newestLinesFirst([line('old'), line('new', '2026-10-08T20:00:00Z')]).map(({ id }) => id))
      .toEqual(['new', 'old']);
  });
});
