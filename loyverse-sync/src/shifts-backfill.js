'use strict';

const { getSyncState, upsertSyncState, recordSyncError, clearSyncError } = require('./sync-state');
const { mirrorShiftsPage } = require('./fetch-all');

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
 * @param {import('surrealdb').Surreal} db
 * @param {import('./config').config} cfg
 * @param {{ startAt?: string, endAt?: string }} [opts]
 */
async function backfillShifts(db, cfg, opts = {}) {
  if (!cfg.syncShifts) return { skipped: true };

  const endAt = opts.endAt || new Date().toISOString();
  const startAt = opts.startAt || '2015-01-01T00:00:00.000Z';
  const state = await getSyncState(db, 'shift');
  let resumeWindow = state?.window_start ? new Date(state.window_start).toISOString() : null;
  let resumeCursor = state?.cursor || null;

  const windows = monthWindows(resumeWindow || startAt, endAt);
  let totalShifts = 0;

  for (const win of windows) {
    let cursor = win.min === resumeWindow ? resumeCursor : null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const page = await mirrorShiftsPage(db, cfg, {
          opened_at_min: win.min,
          opened_at_max: win.max,
          cursor,
        });
        totalShifts += page.shifts;
        cursor = page.nextCursor;
        await upsertSyncState(db, 'shift', {
          cursor,
          window_start: win.min,
          window_end: win.max,
          backfill_complete: false,
          last_synced_at: new Date().toISOString(),
          stats: { totalShifts, window: win },
        });
        if (!cursor) break;
      } catch (err) {
        await recordSyncError(db, 'shift', err);
        throw err;
      }
    }
    resumeWindow = null;
    resumeCursor = null;
  }

  await upsertSyncState(db, 'shift', {
    cursor: null,
    window_start: null,
    window_end: null,
    backfill_complete: true,
    last_synced_at: new Date().toISOString(),
    stats: { totalShifts },
  });
  await clearSyncError(db, 'shift');

  return { totalShifts };
}

module.exports = { backfillShifts };
