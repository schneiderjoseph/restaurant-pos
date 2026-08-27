'use strict';

/**
 * Compare Loyverse API counts vs loyverse_mirror rows.
 * Usage: npm run verify-mirror
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const { config } = require('../src/config');
const { connectSurreal } = require('../src/surreal');
const { LoyverseClient } = require('../src/loyverse-client');
const { countMirrorByResource, loadMirrorPayloads } = require('../src/mirror-upsert');
const { catalogResources, getResource, mirrorIdForRecord } = require('../src/resources');

function stableHash(obj) {
  return crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex').slice(0, 16);
}

function normalizeForCompare(record, def) {
  const copy = JSON.parse(JSON.stringify(record));
  delete copy.updated_at;
  delete copy.synced_at;
  return stableHash(copy);
}

async function apiCount(client, def) {
  if (!def.paginated && !def.listKey) {
    const page = await client.get(def.path);
    const body = page?.merchant || page;
    return body?.id ? 1 : 0;
  }
  const rows = await client.listAll(def.path, def.listKey);
  return rows.length;
}

async function sampleParity(client, db, def, sampleSize = 5) {
  const apiRows = def.paginated !== false && def.listKey
    ? await client.listAll(def.path, def.listKey)
    : [];
  if (apiRows.length === 0) return { sampled: 0, mismatches: [] };

  const mirrorRows = await loadMirrorPayloads(db, def.resource, { activeOnly: false });
  const mirrorById = new Map(
    mirrorRows.map((r) => [mirrorIdForRecord(def, r), r]),
  );

  const sample = apiRows.slice(0, sampleSize);
  /** @type {string[]} */
  const mismatches = [];
  for (const apiRow of sample) {
    const id = mirrorIdForRecord(def, apiRow);
    const mirrorRow = mirrorById.get(id);
    if (!mirrorRow) {
      mismatches.push(`${id}: missing in mirror`);
      continue;
    }
    if (normalizeForCompare(apiRow, def) !== normalizeForCompare(mirrorRow, def)) {
      mismatches.push(`${id}: payload hash differs`);
    }
  }
  return { sampled: sample.length, mismatches };
}

async function main() {
  if (config.surreal.ns === 'posr' && config.surreal.db === 'posr') {
    throw new Error('Refusing verify on posr/posr');
  }

  const client = new LoyverseClient({
    token: config.loyverse.token,
    baseUrl: config.loyverse.baseUrl,
  });
  const db = await connectSurreal(config.surreal);

  try {
    const mirrorCounts = await countMirrorByResource(db);
    const resources = catalogResources();
    if (config.syncSuppliers) resources.push(getResource('supplier'));
    if (config.syncMerchant) resources.push(getResource('merchant'));

    console.log('\n=== Loyverse mirror parity ===\n');
    console.log('resource\tapi\tmirror\tgap\tsample_issues');
    let ok = true;

    for (const def of resources) {
      let apiTotal = 0;
      try {
        apiTotal = await apiCount(client, def);
      } catch (err) {
        console.log(`${def.resource}\tERR\t${mirrorCounts[def.resource] || 0}\t-\t${err.message}`);
        ok = false;
        continue;
      }
      const mirrorTotal = mirrorCounts[def.resource] || 0;
      const gap = apiTotal - mirrorTotal;
      let sampleIssues = 0;
      if (Math.abs(gap) <= 2) {
        try {
          const sample = await sampleParity(client, db, def, 5);
          sampleIssues = sample.mismatches.length;
        } catch {
          sampleIssues = -1;
        }
      }
      if (gap !== 0) ok = false;
      const sampleCol = sampleIssues > 0 ? `${sampleIssues} (hash)` : sampleIssues;
      console.log(
        `${def.resource}\t${apiTotal}\t${mirrorTotal}\t${gap}\t${sampleCol}`,
      );
    }

    console.log(`\nResult: ${ok ? 'OK' : 'GAPS DETECTED'}`);
    process.exit(ok ? 0 : 2);
  } finally {
    if (typeof db.close === 'function') await db.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
