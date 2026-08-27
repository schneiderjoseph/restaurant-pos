'use strict';

const { LoyverseClient } = require('./loyverse-client');
const { RateLimiter, wrapClientWithRateLimit } = require('./rate-limit');
const { upsertMirrorBatch, softDeleteMissingMirror } = require('./mirror-upsert');
const { upsertSyncState, clearSyncError, recordSyncError } = require('./sync-state');
const {
  catalogResources,
  getResource,
  RESOURCES,
  mirrorIdForRecord,
} = require('./resources');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('./resources').LoyverseResource} def
 * @param {import('./config').config} cfg
 */
function isResourceEnabled(def, cfg) {
  if (!cfg.mirrorSync) return false;
  if (def.envFlag) {
    return Boolean(cfg[def.envFlag]);
  }
  return def.catalog !== false;
}

/**
 * Fetch paginated list into mirror.
 * @param {LoyverseClient} client
 * @param {import('surrealdb').Surreal} db
 * @param {import('./resources').LoyverseResource} def
 * @param {Record<string, string|number|undefined>} [extraQuery]
 */
async function mirrorListResource(client, db, def, extraQuery = {}) {
  /** @type {Set<string>} */
  const allActive = new Set();
  let created = 0;
  let updated = 0;
  let pages = 0;
  let cursor;

  do {
    const page = await client.get(def.path, {
      ...extraQuery,
      limit: extraQuery.limit || 250,
      cursor,
    });

    let chunk = [];
    if (def.listKey) {
      chunk = Array.isArray(page?.[def.listKey]) ? page[def.listKey] : [];
    } else {
      // singleton e.g. /merchant
      const body = page?.merchant || page;
      if (body && typeof body === 'object') chunk = [body];
    }

    const batch = await upsertMirrorBatch(db, def, chunk);
    created += batch.created;
    updated += batch.updated;
    for (const id of batch.activeIds) allActive.add(id);
    pages += 1;
    cursor = page?.cursor || null;
    if (cursor) await sleep(120);
  } while (cursor && def.paginated !== false);

  let deactivated = 0;
  if (def.catalog && def.paginated !== false && !extraQuery.created_at_min) {
    deactivated = await softDeleteMissingMirror(db, def.resource, allActive);
  }

  await clearSyncError(db, def.resource);
  await upsertSyncState(db, def.resource, {
    cursor: null,
    last_synced_at: new Date().toISOString(),
    stats: { pages, created, updated, deactivated, total: allActive.size },
  });

  return { resource: def.resource, pages, created, updated, deactivated, total: allActive.size };
}

/**
 * Mirror all enabled catalogue resources.
 * @param {import('surrealdb').Surreal} db
 * @param {import('./config').config} cfg
 * @param {{ resources?: string[] }} [opts]
 */
async function mirrorCatalog(db, cfg, opts = {}) {
  const limiter = new RateLimiter({ rpm: cfg.rateLimitRpm });
  const client = wrapClientWithRateLimit(
    new LoyverseClient({ token: cfg.loyverse.token, baseUrl: cfg.loyverse.baseUrl }),
    limiter,
  );

  const wanted = opts.resources?.length
    ? opts.resources.map(getResource)
    : catalogResources().filter((r) => isResourceEnabled(r, cfg));

  /** @type {Record<string, object>} */
  const results = {};
  for (const def of wanted) {
    try {
      results[def.resource] = await mirrorListResource(client, db, def);
    } catch (err) {
      await recordSyncError(db, def.resource, err);
      throw err;
    }
  }

  // Optional non-catalog resources when flags on
  for (const def of RESOURCES.filter((r) => !r.catalog && r.resource !== 'receipt' && r.resource !== 'shift' && r.resource !== 'inventory')) {
    if (!isResourceEnabled(def, cfg)) continue;
    try {
      results[def.resource] = await mirrorListResource(client, db, def);
    } catch (err) {
      await recordSyncError(db, def.resource, err);
      console.warn(`[mirror] ${def.resource} failed:`, err?.message || err);
    }
  }

  return results;
}

/**
 * Mirror inventory (full refresh).
 */
async function mirrorInventory(db, cfg) {
  const def = getResource('inventory');
  if (!isResourceEnabled(def, cfg)) return { skipped: true };
  const limiter = new RateLimiter({ rpm: cfg.rateLimitRpm });
  const client = wrapClientWithRateLimit(
    new LoyverseClient({ token: cfg.loyverse.token, baseUrl: cfg.loyverse.baseUrl }),
    limiter,
  );
  return mirrorListResource(client, db, def);
}

/**
 * Incremental receipts: one time window page batch (for backfill/resume).
 * @param {import('surrealdb').Surreal} db
 * @param {import('./config').config} cfg
 * @param {{ created_at_min: string, created_at_max: string, cursor?: string|null }} window
 */
async function mirrorReceiptsPage(db, cfg, window) {
  const def = getResource('receipt');
  const limiter = new RateLimiter({ rpm: cfg.rateLimitRpm });
  const client = wrapClientWithRateLimit(
    new LoyverseClient({ token: cfg.loyverse.token, baseUrl: cfg.loyverse.baseUrl }),
    limiter,
  );

  const query = {
    created_at_min: window.created_at_min,
    created_at_max: window.created_at_max,
    limit: 250,
    cursor: window.cursor || undefined,
  };

  const page = await client.get(def.path, query);
  const chunk = Array.isArray(page?.receipts) ? page.receipts : [];
  const batch = await upsertMirrorBatch(db, def, chunk);

  return {
    receipts: chunk.length,
    created: batch.created,
    updated: batch.updated,
    nextCursor: page?.cursor || null,
    ids: chunk.map((r) => mirrorIdForRecord(def, r)),
  };
}

/**
 * Incremental shifts page.
 */
async function mirrorShiftsPage(db, cfg, window) {
  const def = getResource('shift');
  const limiter = new RateLimiter({ rpm: cfg.rateLimitRpm });
  const client = wrapClientWithRateLimit(
    new LoyverseClient({ token: cfg.loyverse.token, baseUrl: cfg.loyverse.baseUrl }),
    limiter,
  );

  const query = {
    opened_at_min: window.opened_at_min,
    opened_at_max: window.opened_at_max,
    limit: 250,
    cursor: window.cursor || undefined,
  };

  const page = await client.get(def.path, query);
  const chunk = Array.isArray(page?.shifts) ? page.shifts : [];
  const batch = await upsertMirrorBatch(db, def, chunk);

  return {
    shifts: chunk.length,
    created: batch.created,
    updated: batch.updated,
    nextCursor: page?.cursor || null,
  };
}

module.exports = {
  isResourceEnabled,
  mirrorListResource,
  mirrorCatalog,
  mirrorInventory,
  mirrorReceiptsPage,
  mirrorShiftsPage,
};
