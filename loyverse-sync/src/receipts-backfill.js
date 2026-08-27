'use strict';

const { getSyncState, upsertSyncState, recordSyncError, clearSyncError } = require('./sync-state');
const { mirrorReceiptsPage } = require('./fetch-all');
const { projectReceiptsFromMirror } = require('./order-projection');

function addMonths(iso, months) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function monthWindows(startIso, endIso) {
  /** @type {{ min: string, max: string }[]} */
  const windows = [];
  let cursor = new Date(startIso);
  const end = new Date(endIso);
  while (cursor < end) {
    const min = cursor.toISOString();
    const next = new Date(cursor);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const max = next > end ? end.toISOString() : next.toISOString();
    windows.push({ min, max });
    cursor = next;
  }
  return windows;
}

/**
 * Backfill all receipts into mirror (+ optional POSR projection).
 * Resumes from loyverse_sync_state.
 * @param {import('surrealdb').Surreal} db
 * @param {import('./config').config} cfg
 * @param {{ project?: boolean, startAt?: string, endAt?: string }} [opts]
 */
async function backfillReceipts(db, cfg, opts = {}) {
  if (!cfg.syncReceipts) return { skipped: true };

  const endAt = opts.endAt || new Date().toISOString();
  const startAt = opts.startAt || '2015-01-01T00:00:00.000Z';
  const state = await getSyncState(db, 'receipt');
  let resumeWindow = state?.window_start ? new Date(state.window_start).toISOString() : null;
  let resumeCursor = state?.cursor || null;

  const windows = monthWindows(resumeWindow || startAt, endAt);
  let totalReceipts = 0;
  let windowsDone = 0;

  for (const win of windows) {
    let cursor = win.min === resumeWindow ? resumeCursor : null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const page = await mirrorReceiptsPage(db, cfg, {
          created_at_min: win.min,
          created_at_max: win.max,
          cursor,
        });
        totalReceipts += page.receipts;
        cursor = page.nextCursor;
        await upsertSyncState(db, 'receipt', {
          cursor,
          window_start: win.min,
          window_end: win.max,
          backfill_complete: false,
          last_synced_at: new Date().toISOString(),
          stats: { totalReceipts, window: win },
        });
        if (!cursor) break;
      } catch (err) {
        await recordSyncError(db, 'receipt', err);
        throw err;
      }
    }
    resumeWindow = null;
    resumeCursor = null;
    windowsDone += 1;
  }

  await upsertSyncState(db, 'receipt', {
    cursor: null,
    window_start: null,
    window_end: null,
    backfill_complete: true,
    last_synced_at: new Date().toISOString(),
    stats: { totalReceipts, windowsDone },
  });
  await clearSyncError(db, 'receipt');

  let projected = null;
  if (opts.project !== false && cfg.projectReceipts) {
    projected = await projectReceiptsFromMirror(db, { limit: cfg.receiptProjectBatch });
  }

  return { totalReceipts, windowsDone, projected };
}

/**
 * Incremental receipts since last sync (overlap 5 min).
 */
async function syncReceiptsIncremental(db, cfg) {
  if (!cfg.syncReceipts) return { skipped: true };
  const state = await getSyncState(db, 'receipt');
  if (!state?.backfill_complete && cfg.receiptsBackfill) {
    return backfillReceipts(db, cfg);
  }

  const overlapMs = 5 * 60 * 1000;
  const since = state?.last_synced_at
    ? new Date(new Date(state.last_synced_at).getTime() - overlapMs).toISOString()
    : addMonths(new Date().toISOString(), -1);

  let cursor;
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const page = await mirrorReceiptsPage(db, cfg, {
      created_at_min: since,
      created_at_max: new Date().toISOString(),
      cursor,
    });
    total += page.receipts;
    cursor = page.nextCursor;
    if (!cursor) break;
  }

  await upsertSyncState(db, 'receipt', {
    last_synced_at: new Date().toISOString(),
    stats: { incremental: total },
  });

  let projected = null;
  if (cfg.projectReceipts) {
    projected = await projectReceiptsFromMirror(db, { since, limit: cfg.receiptProjectBatch });
  }

  return { total, projected };
}

module.exports = {
  backfillReceipts,
  syncReceiptsIncremental,
  monthWindows,
};
