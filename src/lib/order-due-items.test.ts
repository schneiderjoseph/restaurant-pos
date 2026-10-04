import { describe, expect, it, vi } from 'vitest';
import { fetchDueOrderItemIds, flattenOrderItemIds } from '@/lib/order-due-items.ts';

describe('flattenOrderItemIds', () => {
  it('flattens one array of items per order', () => {
    expect(flattenOrderItemIds([['a', 'b'], ['c']])).toEqual(['a', 'b', 'c']);
  });

  it('drops orders without items and empty holes', () => {
    expect(flattenOrderItemIds([null, undefined, [], ['a', null]])).toEqual(['a']);
  });

  it('returns nothing for a result that is not a list', () => {
    expect(flattenOrderItemIds(undefined)).toEqual([]);
    expect(flattenOrderItemIds(null)).toEqual([]);
  });
});

describe('fetchDueOrderItemIds', () => {
  it('asks for orders taken before the day and wanted from it on', async () => {
    const query = vi.fn().mockResolvedValue([[['a'], ['b', 'c']]]);
    const startDate = new Date('2026-10-05T04:00:00Z');

    await expect(fetchDueOrderItemIds({ query }, startDate)).resolves.toEqual(['a', 'b', 'c']);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('due_at >= $startDate');
    expect(sql).toContain('created_at < $startDate');
    expect(params).toEqual({ startDate });
  });

  it('returns nothing when the lookup fails, so the screen still loads', async () => {
    const query = vi.fn().mockRejectedValue(new Error('down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(fetchDueOrderItemIds({ query }, new Date())).resolves.toEqual([]);

    error.mockRestore();
  });
});
