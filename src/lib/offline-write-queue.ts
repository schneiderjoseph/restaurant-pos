/**
 * Offline Write Queue — IndexedDB-backed queue for POS writes that happen
 * while the SurrealDB WebSocket is disconnected.
 *
 * Research finding: "Cloud POS dies when internet dies" is the #3 pain point
 * in restaurant POS forums (18 mentions). Toast and Square both have offline
 * write modes that allow continuing operations during outages.
 *
 * Architecture:
 *   - enqueue(): stores the write operation in IndexedDB
 *   - replay(): iterates pending ops and executes them against SurrealDB
 *   - Auto-replay: triggered by useOfflineQueue hook when connection restores
 *   - Conflict handling: uses SurrealDB MERGE (last-write-wins for updates)
 *
 * The queue stores operations, not raw data — so a 'create order' operation
 * stores the full order + items, and replay() creates them in the right order.
 *
 * Supported operations:
 *   - create: db.create(table, data)
 *   - update: db.update(recordId, data)
 *   - merge: db.merge(recordId, data)
 *   - delete: db.delete(recordId)
 *
 * Limitations:
 *   - Live queries won't update until the write is replayed (UI shows local
 *     state via optimistic updates — the caller is responsible for that)
 *   - If two terminals write to the same record offline, last-write-wins
 *     (SurrealDB MERGE semantics)
 *   - Complex transactions (multi-table atomic) are not supported — each
 *     operation is replayed independently
 */

import { createStore, get, set, del, keys } from 'idb-keyval';
import { DateTime, Decimal, Duration, RecordId, StringRecordId, Uuid } from 'surrealdb';

// Dedicated DB name — `posr-react` already exists with only `jotai-storage`;
// idb-keyval cannot add new object stores to an existing database.
const QUEUE_STORE = createStore('posr-react-offline-write-queue', 'keyval');

export type QueueOperation = 'create' | 'update' | 'merge' | 'delete';

export interface QueuedWrite {
  id: string;
  operation: QueueOperation;
  table?: string;       // for 'create'
  recordId?: string;    // for 'update', 'merge', 'delete'
  data?: any;           // payload for 'create', 'update', 'merge'
  createdAt: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  attempts: number;
}

const MAX_RETRIES = 3;

/**
 * IndexedDB stores values with the structured clone algorithm, which drops
 * class prototypes: a surrealdb DateTime comes back as `{}` and Surreal then
 * rejects the replay ("Expected datetime but found {}"). So Surreal value
 * classes are stored as tagged strings and rebuilt before replay.
 */
const SURREAL_TAG = '__surreal';

type SurrealKind = 'datetime' | 'record' | 'duration' | 'decimal' | 'uuid';

function tagged(kind: SurrealKind, value: string) {
  return { [SURREAL_TAG]: kind, value };
}

export function toStorable(value: unknown): unknown {
  if (value instanceof DateTime) return tagged('datetime', value.toISOString());
  if (value instanceof RecordId || value instanceof StringRecordId) return tagged('record', String(value));
  if (value instanceof Duration) return tagged('duration', String(value));
  if (value instanceof Decimal) return tagged('decimal', String(value));
  if (value instanceof Uuid) return tagged('uuid', String(value));
  if (Array.isArray(value)) return value.map(toStorable);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toStorable(v)]));
  }
  return value; // primitives and Date survive structured clone as-is
}

export function fromStorable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromStorable);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const kind = record[SURREAL_TAG];
    if (typeof kind === 'string' && typeof record.value === 'string') {
      switch (kind as SurrealKind) {
        case 'datetime': return new DateTime(record.value);
        case 'record': return new StringRecordId(record.value);
        case 'duration': return new Duration(record.value);
        case 'decimal': return new Decimal(record.value);
        case 'uuid': return new Uuid(record.value);
      }
    }
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, fromStorable(v)]));
  }
  return value;
}

/**
 * Generate a unique ID for the queue entry.
 */
function generateId(): string {
  return `owq_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Enqueue a write operation. Called by the DatabaseProvider when the
 * WebSocket is disconnected and a write is attempted.
 *
 * @returns the queue entry ID (for tracking / optimistic UI)
 */
export async function enqueueWrite(
  operation: QueueOperation,
  params: { table?: string; recordId?: string; data?: any }
): Promise<string> {
  const entry: QueuedWrite = {
    id: generateId(),
    operation,
    table: params.table,
    recordId: params.recordId,
    data: toStorable(params.data),
    createdAt: Date.now(),
    status: 'pending',
    attempts: 0,
  };
  await set(entry.id, entry, QUEUE_STORE);
  return entry.id;
}

async function getWritesWithStatus(
  statuses: QueuedWrite['status'][],
): Promise<QueuedWrite[]> {
  const allKeys = await keys(QUEUE_STORE);
  const entries: QueuedWrite[] = [];
  for (const key of allKeys) {
    const entry = await get(key, QUEUE_STORE);
    if (entry && statuses.includes(entry.status)) {
      entries.push(entry);
    }
  }
  return entries.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Get all pending writes, sorted by creation time (FIFO). An interrupted
 * replay can leave an entry in 'syncing' — it is retried too.
 */
export async function getPendingWrites(): Promise<QueuedWrite[]> {
  return getWritesWithStatus(['pending', 'syncing']);
}

/**
 * Get the count of pending writes (for UI badge).
 */
export async function getPendingCount(): Promise<number> {
  const pending = await getPendingWrites();
  return pending.length;
}

/**
 * Writes the database refused MAX_RETRIES times. Kept (not silently dropped)
 * so the UI can show them, but no longer replayed or counted as pending.
 */
export async function getFailedWrites(): Promise<QueuedWrite[]> {
  return getWritesWithStatus(['failed']);
}

export async function getFailedCount(): Promise<number> {
  const failed = await getFailedWrites();
  return failed.length;
}

/** Discard the refused writes (explicit user action only). */
export async function clearFailedWrites(): Promise<number> {
  const failed = await getFailedWrites();
  for (const entry of failed) {
    await del(entry.id, QUEUE_STORE);
  }
  return failed.length;
}

/**
 * Execute a single queued write against the database.
 * Returns true on success, false on failure.
 */
async function executeWrite(db: any, entry: QueuedWrite): Promise<boolean> {
  const data = fromStorable(entry.data);
  try {
    switch (entry.operation) {
      case 'create': {
        if (!entry.table) throw new Error('Missing table for create operation');
        await db.create(entry.table, data);
        break;
      }
      case 'update': {
        if (!entry.recordId) throw new Error('Missing recordId for update operation');
        await db.update(entry.recordId, data);
        break;
      }
      case 'merge': {
        if (!entry.recordId) throw new Error('Missing recordId for merge operation');
        await db.merge(entry.recordId, data);
        break;
      }
      case 'delete': {
        if (!entry.recordId) throw new Error('Missing recordId for delete operation');
        await db.delete(entry.recordId);
        break;
      }
      default:
        throw new Error(`Unknown operation: ${entry.operation}`);
    }
    return true;
  } catch (err: any) {
    entry.error = err?.message || String(err);
    return false;
  }
}

/**
 * Replay all pending writes against the database.
 * Called when the WebSocket connection is restored.
 *
 * @param db — the useDB() instance (connected Surreal client)
 * @returns summary of synced/failed counts
 */
export async function replayQueue(db: any): Promise<{ synced: number; failed: number; remaining: number }> {
  const pending = await getPendingWrites();
  let synced = 0;
  let failed = 0;

  for (const entry of pending) {
    // Mark as syncing
    entry.status = 'syncing';
    entry.attempts += 1;
    await set(entry.id, entry, QUEUE_STORE);

    const success = await executeWrite(db, entry);

    if (success) {
      entry.status = 'synced';
      await set(entry.id, entry, QUEUE_STORE);
      // Remove from queue after successful sync
      await del(entry.id, QUEUE_STORE);
      synced++;
    } else {
      // Retry logic
      if (entry.attempts >= MAX_RETRIES) {
        entry.status = 'failed';
        await set(entry.id, entry, QUEUE_STORE);
        failed++;
      } else {
        // Reset to pending for next replay attempt
        entry.status = 'pending';
        await set(entry.id, entry, QUEUE_STORE);
      }
    }
  }

  const remaining = await getPendingCount();
  return { synced, failed, remaining };
}

/**
 * Clear all synced/failed entries (cleanup).
 */
export async function clearQueue(): Promise<void> {
  const allKeys = await keys(QUEUE_STORE);
  for (const key of allKeys) {
    await del(key, QUEUE_STORE);
  }
}

/**
 * Get a specific queue entry by ID (for optimistic UI tracking).
 */
export async function getQueueEntry(id: string): Promise<QueuedWrite | undefined> {
  return get(id, QUEUE_STORE);
}

/**
 * Update a queue entry (e.g., add optimistic data from the UI).
 */
export async function updateQueueEntry(id: string, updates: Partial<QueuedWrite>): Promise<void> {
  const entry = await get(id, QUEUE_STORE);
  if (entry) {
    await set(id, { ...entry, ...updates }, QUEUE_STORE);
  }
}
