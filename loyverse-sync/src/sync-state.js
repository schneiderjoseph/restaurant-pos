'use strict';

const { queryRows, asRecord } = require('./surreal');

const STATE_TABLE = 'loyverse_sync_state';

async function getSyncState(db, resource) {
  const rows = await queryRows(
    db,
    `SELECT * FROM ${STATE_TABLE} WHERE resource = $resource LIMIT 1`,
    { resource },
  );
  return rows[0] || null;
}

/**
 * @param {import('surrealdb').Surreal} db
 * @param {string} resource
 * @param {Partial<{ cursor: string|null, backfill_complete: boolean, last_error: string|null, stats: object, window_start: string|null, window_end: string|null, last_synced_at: string|null }>} patch
 */
async function upsertSyncState(db, resource, patch) {
  const existing = await getSyncState(db, resource);
  const merged = {
    resource,
    cursor: patch.cursor !== undefined ? patch.cursor : existing?.cursor ?? null,
    backfill_complete:
      patch.backfill_complete !== undefined
        ? patch.backfill_complete
        : existing?.backfill_complete ?? false,
    last_error: patch.last_error !== undefined ? patch.last_error : existing?.last_error ?? null,
    stats: patch.stats !== undefined ? patch.stats : existing?.stats ?? {},
    window_start:
      patch.window_start !== undefined ? patch.window_start : existing?.window_start ?? null,
    window_end: patch.window_end !== undefined ? patch.window_end : existing?.window_end ?? null,
    last_synced_at:
      patch.last_synced_at !== undefined ? patch.last_synced_at : existing?.last_synced_at ?? null,
  };

  const sets = ['backfill_complete = $backfill_complete', 'stats = $stats'];
  const vars = {
    resource,
    backfill_complete: merged.backfill_complete,
    stats: merged.stats,
  };

  if (merged.cursor != null && merged.cursor !== '') {
    vars.cursor = String(merged.cursor);
    sets.push('cursor = $cursor');
  } else {
    sets.push('cursor = NONE');
  }
  if (merged.last_error != null && merged.last_error !== '') {
    vars.last_error = String(merged.last_error);
    sets.push('last_error = $last_error');
  } else {
    sets.push('last_error = NONE');
  }
  if (merged.window_start) {
    vars.window_start = merged.window_start;
    sets.push('window_start = type::datetime($window_start)');
  } else {
    sets.push('window_start = NONE');
  }
  if (merged.window_end) {
    vars.window_end = merged.window_end;
    sets.push('window_end = type::datetime($window_end)');
  } else {
    sets.push('window_end = NONE');
  }
  if (merged.last_synced_at) {
    vars.last_synced_at = merged.last_synced_at;
    sets.push('last_synced_at = type::datetime($last_synced_at)');
  } else {
    sets.push('last_synced_at = NONE');
  }

  const fieldSet = sets.join(',\n        ');

  if (existing?.id) {
    await queryRows(
      db,
      `UPDATE $id SET
        ${fieldSet}`,
      { id: asRecord(existing.id), ...vars },
    );
  } else {
    await queryRows(
      db,
      `CREATE ${STATE_TABLE} SET
        resource = $resource,
        ${fieldSet}`,
      vars,
    );
  }
  return merged;
}

async function clearSyncError(db, resource) {
  return upsertSyncState(db, resource, { last_error: null });
}

async function recordSyncError(db, resource, err) {
  const msg = String(err?.message || err || 'unknown error').slice(0, 2000);
  return upsertSyncState(db, resource, { last_error: msg });
}

module.exports = {
  getSyncState,
  upsertSyncState,
  clearSyncError,
  recordSyncError,
};
