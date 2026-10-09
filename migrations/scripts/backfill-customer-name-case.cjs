'use strict';

/**
 * Rewrites existing customer names as "Jhon Carter": each word capitalized, the rest
 * lowercase, single spaces. Same rule as formatPersonName (src/lib/guest-label.ts),
 * which new and edited customers already go through.
 *
 * Usage:
 *   SURREAL_USER=... SURREAL_PASS=... node migrations/scripts/backfill-customer-name-case.cjs
 *
 * Env:
 *   DRY_RUN=1 — list the changes, do not write
 */

const WS = require('ws');
const { Surreal, StringRecordId } = require('surrealdb');
if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = WS;
}

const DB_URL = process.env.SURREAL_URL || 'ws://localhost:8000/rpc';
const DB_NS = process.env.SURREAL_NS || 'posr';
const DB_NAME = process.env.SURREAL_DB || 'posr';
const DB_USER = process.env.SURREAL_USER;
const DB_PASS = process.env.SURREAL_PASS;
if (!DB_USER || !DB_PASS) {
  console.error('ERROR: SURREAL_USER and SURREAL_PASS env vars are required.');
  process.exit(1);
}
const DRY_RUN = process.env.DRY_RUN === '1';

const rows = (result) => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? first : [];
};

/** "jHON  CartEr" → "Jhon Carter"; also after a hyphen or apostrophe ("Jean-Pierre O'Brien"). */
function formatPersonName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('fr')
    .replace(/(^|[\s'’-])(\p{L})/gu, (_, separator, letter) => separator + letter.toLocaleUpperCase('fr'));
}

async function main() {
  const db = new Surreal();
  await db.connect(DB_URL);
  await db.signin({ username: DB_USER, password: DB_PASS });
  await db.use({ namespace: DB_NS, database: DB_NAME });

  const customers = rows(await db.query(`SELECT id, name FROM customer WHERE name != NONE AND name != ''`));
  const changes = customers
    .map((c) => ({ id: String(c.id), from: c.name, to: formatPersonName(c.name) }))
    .filter((c) => c.to && c.to !== c.from);

  console.log(`customers: ${customers.length}, names to fix: ${changes.length}${DRY_RUN ? ' (dry run)' : ''}`);
  for (const change of changes) {
    console.log(`  ${change.id}  "${change.from}" → "${change.to}"`);
    if (!DRY_RUN) {
      await db.query(`UPDATE $id SET name = $name`, { id: new StringRecordId(change.id), name: change.to });
    }
  }

  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
