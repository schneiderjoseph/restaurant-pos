'use strict';

const { queryRows, asRecord, recordIdString } = require('./surreal');
const { mirrorIdForRecord, parseApiDatetime } = require('./resources');

/**
 * Upsert one mirror row (idempotent on resource + loyverse_id).
 * @param {import('surrealdb').Surreal} db
 * @param {import('./resources').LoyverseResource} def
 * @param {object} record Raw API payload
 */
async function upsertMirrorRecord(db, def, record) {
  const loyverseId = mirrorIdForRecord(def, record);
  const deletedAt = parseApiDatetime(record.deleted_at || record.permanent_deletion_at);
  const updatedAt =
    parseApiDatetime(record.updated_at) ||
    parseApiDatetime(record.created_at) ||
    parseApiDatetime(record.opened_at) ||
    parseApiDatetime(record.closed_at);

  const existing = await queryRows(
    db,
    `SELECT id FROM loyverse_mirror
     WHERE resource = $resource AND loyverse_id = $loyverse_id
     LIMIT 1`,
    { resource: def.resource, loyverse_id: loyverseId },
  );

  const vars = {
    resource: def.resource,
    loyverse_id: loyverseId,
    payload: record,
  };

  const sets = ['payload = $payload', 'synced_at = time::now()'];
  if (updatedAt) {
    vars.api_updated_at = updatedAt;
    sets.push('api_updated_at = type::datetime($api_updated_at)');
  } else {
    sets.push('api_updated_at = NONE');
  }
  if (deletedAt) {
    vars.deleted_at = deletedAt;
    sets.push('deleted_at = type::datetime($deleted_at)');
  } else {
    sets.push('deleted_at = NONE');
  }
  const fieldSet = sets.join(',\n        ');

  if (existing[0]?.id) {
    await queryRows(
      db,
      `UPDATE $id SET
        ${fieldSet}`,
      { id: asRecord(existing[0].id), ...vars },
    );
    return { id: recordIdString(existing[0].id), loyverseId, action: 'updated' };
  }

  const created = await queryRows(
    db,
    `CREATE loyverse_mirror SET
      resource = $resource,
      loyverse_id = $loyverse_id,
      ${fieldSet}`,
    vars,
  );
  return {
    id: recordIdString(created[0]?.id),
    loyverseId,
    action: 'created',
  };
}

/**
 * @param {import('surrealdb').Surreal} db
 * @param {import('./resources').LoyverseResource} def
 * @param {object[]} records
 */
async function upsertMirrorBatch(db, def, records) {
  let created = 0;
  let updated = 0;
  /** @type {Set<string>} */
  const activeIds = new Set();

  for (const record of records) {
    try {
      const out = await upsertMirrorRecord(db, def, record);
      activeIds.add(out.loyverseId);
      if (out.action === 'created') created += 1;
      else updated += 1;
    } catch (err) {
      console.warn(`[mirror] skip ${def.resource}:`, err?.message || err);
    }
  }

  return { created, updated, activeIds, total: records.length };
}

/**
 * Soft-delete mirror rows for this resource not seen in the latest full pull.
 * @param {import('surrealdb').Surreal} db
 * @param {string} resource
 * @param {Set<string>} activeIds
 */
async function softDeleteMissingMirror(db, resource, activeIds) {
  const existing = await queryRows(
    db,
    `SELECT id, loyverse_id FROM loyverse_mirror
     WHERE resource = $resource AND (deleted_at = NONE OR deleted_at = NULL)`,
    { resource },
  );
  let deactivated = 0;
  const now = new Date().toISOString();
  for (const row of existing) {
    const lid = String(row.loyverse_id || '');
    if (!activeIds.has(lid)) {
      await queryRows(
        db,
        `UPDATE $id SET deleted_at = type::datetime($deleted_at), synced_at = time::now()`,
        { id: asRecord(row.id), deleted_at: now },
      );
      deactivated += 1;
    }
  }
  return deactivated;
}

/**
 * Load all mirror payloads for a resource (optionally active only).
 * @param {import('surrealdb').Surreal} db
 * @param {string} resource
 * @param {{ activeOnly?: boolean }} [opts]
 */
async function loadMirrorPayloads(db, resource, opts = {}) {
  const sql = opts.activeOnly
    ? `SELECT payload FROM loyverse_mirror
       WHERE resource = $resource AND (deleted_at = NONE OR deleted_at = NULL)`
    : `SELECT payload FROM loyverse_mirror WHERE resource = $resource`;
  const rows = await queryRows(db, sql, { resource });
  return rows.map((r) => r.payload).filter(Boolean);
}

/**
 * Count mirror rows by resource.
 * @param {import('surrealdb').Surreal} db
 */
async function countMirrorByResource(db) {
  const rows = await queryRows(
    db,
    `SELECT resource, count() AS cnt FROM loyverse_mirror GROUP BY resource`,
  );
  /** @type {Record<string, number>} */
  const out = {};
  for (const row of rows) {
    out[String(row.resource)] = Number(row.cnt) || 0;
  }
  return out;
}

module.exports = {
  upsertMirrorRecord,
  upsertMirrorBatch,
  softDeleteMissingMirror,
  loadMirrorPayloads,
  countMirrorByResource,
};
