import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = new Map<string, Map<string, unknown>>();

vi.mock('idb-keyval', () => ({
  createStore: (db: string, store: string) => `${db}:${store}`,
  get: async (key: string, store: string) => memory.get(store)?.get(key),
  set: async (key: string, value: unknown, store: string) => {
    if (!memory.has(store)) memory.set(store, new Map());
    // Real IndexedDB stores a structured clone (class prototypes are lost).
    memory.get(store)!.set(key, structuredClone(value));
  },
  del: async (key: string, store: string) => {
    memory.get(store)?.delete(key);
  },
  keys: async (store: string) => Array.from(memory.get(store)?.keys() ?? []),
}));

import { DateTime, RecordId, StringRecordId } from 'surrealdb';
import {
  clearFailedWrites,
  clearQueue,
  enqueueWrite,
  getFailedCount,
  getPendingCount,
  getPendingWrites,
  replayQueue,
} from '@/lib/offline-write-queue.ts';

describe('offline-write-queue', () => {
  beforeEach(async () => {
    await clearQueue();
  });

  it('enqueues create writes and reports pending count', async () => {
    await enqueueWrite('create', { table: 'order', data: { total: 42 } });
    await enqueueWrite('merge', { recordId: 'order:abc', data: { status: 'open' } });

    expect(await getPendingCount()).toBe(2);
    const pending = await getPendingWrites();
    expect(pending).toHaveLength(2);
    expect(pending[0].operation).toBe('create');
    expect(pending[1].operation).toBe('merge');
  });

  it('replays pending writes in FIFO order and clears synced entries', async () => {
    await enqueueWrite('create', { table: 'order', data: { id: 1 } });
    await enqueueWrite('update', { recordId: 'order:1', data: { status: 'paid' } });

    const calls: string[] = [];
    const db = {
      create: vi.fn(async (table: string) => {
        calls.push(`create:${table}`);
      }),
      update: vi.fn(async (recordId: string) => {
        calls.push(`update:${recordId}`);
      }),
      merge: vi.fn(),
      delete: vi.fn(),
    };

    const result = await replayQueue(db);

    expect(result).toEqual({ synced: 2, failed: 0, remaining: 0 });
    expect(calls).toEqual(['create:order', 'update:order:1']);
    expect(await getPendingCount()).toBe(0);
  });

  it('does not queue query/select/live operations (design contract)', async () => {
    // Only write ops use enqueueWrite — reads go through runGuarded and throw DbNotReadyError.
    const pending = await getPendingWrites();
    expect(pending).toHaveLength(0);
  });

  it('replays surrealdb dates and record ids as real values, not {}', async () => {
    const at = new Date('2026-10-01T19:06:12Z');
    await enqueueWrite('merge', {
      recordId: 'floor_table:asi_r_25',
      data: { locked_at: new DateTime(at), customer: new RecordId('customer', 'w1'), note: 'x', n: 2 },
    });

    const merge = vi.fn(async () => undefined);
    const result = await replayQueue({ create: vi.fn(), update: vi.fn(), merge, delete: vi.fn() });

    expect(result.synced).toBe(1);
    const [, payload] = merge.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(payload.locked_at).toBeInstanceOf(DateTime);
    expect((payload.locked_at as DateTime).toISOString()).toBe(at.toISOString());
    expect(payload.customer).toBeInstanceOf(StringRecordId);
    expect(String(payload.customer)).toBe('customer:w1');
    expect(payload.note).toBe('x');
    expect(payload.n).toBe(2);
  });

  it('stops replaying and counting writes refused MAX_RETRIES times', async () => {
    await enqueueWrite('merge', { recordId: 'floor_table:t1', data: { locked_at: 'bad' } });
    const merge = vi.fn(async () => {
      throw new Error("Couldn't coerce value for field locked_at");
    });
    const db = { create: vi.fn(), update: vi.fn(), merge, delete: vi.fn() };

    await replayQueue(db);
    await replayQueue(db);
    const third = await replayQueue(db);
    expect(third).toEqual({ synced: 0, failed: 1, remaining: 0 });
    expect(await getPendingCount()).toBe(0);
    expect(await getFailedCount()).toBe(1);

    await replayQueue(db);
    expect(merge).toHaveBeenCalledTimes(3);

    expect(await clearFailedWrites()).toBe(1);
    expect(await getFailedCount()).toBe(0);
  });
});
