'use strict';

const { queryRows, asRecord } = require('./surreal');

/** Written by the sync: ASI outlets (mPOS) offered in Manage → General settings. */
const ASI_OUTLETS_KEY = 'asi_outlets';
/** Written by Manage: posIDs to sync, in priority order (first wins on price conflicts). */
const ASI_POS_IDS_KEY = 'asi_pos_ids';

async function readSetting(db, key) {
  const rows = await queryRows(
    db,
    `SELECT id, values FROM setting WHERE key = $key AND is_global = true LIMIT 1`,
    { key },
  );
  return rows[0] || null;
}

/**
 * Outlets picked in Manage. Empty = nothing picked yet (caller falls back to
 * ASI_POS_ID, then to all outlets).
 * @returns {Promise<number[]>}
 */
async function readSelectedPosIds(db) {
  const row = await readSetting(db, ASI_POS_IDS_KEY);
  const values = Array.isArray(row?.values) ? row.values : [];
  const ids = values.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(ids)];
}

/** Surreal returns object keys sorted, so compare with sorted keys. */
function stableJson(value) {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

/** Publish the ASI outlet list so the POS can offer it; skips the write when unchanged. */
async function writeAsiOutlets(db, outlets) {
  const row = await readSetting(db, ASI_OUTLETS_KEY);
  if (row?.id) {
    if (stableJson(row.values) === stableJson(outlets)) return;
    await queryRows(db, `UPDATE $id SET values = $values`, {
      id: asRecord(row.id),
      values: outlets,
    });
    return;
  }
  await queryRows(
    db,
    `CREATE setting SET key = $key, is_global = true, values = $values`,
    { key: ASI_OUTLETS_KEY, values: outlets },
  );
}

module.exports = {
  ASI_OUTLETS_KEY,
  ASI_POS_IDS_KEY,
  readSelectedPosIds,
  writeAsiOutlets,
};
