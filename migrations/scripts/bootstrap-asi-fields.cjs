'use strict';

/**
 * Apply the ASI/Resort F&B field migrations that predate `migrations/latest.surql`
 * and are NOT covered by run-prod-migrations.cjs's MIGRATION_PLAN (that plan was
 * frozen before these shipped — see docs/deploy/install-asi-prod.ps1).
 *
 * Safe to re-run: each statement is applied individually and "already exists /
 * already defined" errors are treated as already-applied (skip), matching the
 * pattern in loyverse-sync/scripts/bootstrap-loyverse-db.js.
 *
 * Env: SURREAL_URL, SURREAL_NS (default posr), SURREAL_DB (default posr),
 *      SURREAL_USER, SURREAL_PASS
 *
 * Usage (repo root): node migrations/scripts/bootstrap-asi-fields.cjs
 */

const fs = require('fs');
const path = require('path');
const WS = require('ws');
const { Surreal } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') global.WebSocket = WS;

const url = process.env.SURREAL_URL || 'ws://127.0.0.1:8000/rpc';
const ns = process.env.SURREAL_NS || 'posr';
const dbName = process.env.SURREAL_DB || 'posr';
const user = process.env.SURREAL_USER;
const pass = process.env.SURREAL_PASS;
if (!user || !pass) {
  console.error('ERROR: SURREAL_USER and SURREAL_PASS are required.');
  process.exit(1);
}

const root = path.join(__dirname, '..', '..');

// Chronological order matches the original commits (see git history):
// resort_customer_pms is the earlier/fallback definition of the customer
// fields that asi_guest_fields.surql later OVERWRITEs with the full ASI FD
// mapping — applied first so the OVERWRITE version wins.
const FILES = [
  '2026_08_24_asi_room_fields.surql',
  '2026_08_24_asi_table_fields.surql',
  '2026_08_24_resort_customer_pms.surql',
  '2026_08_24_asi_guest_fields.surql',
  '2026_08_24_asi_sync_fields.surql',
  '2026_08_24_kitchen_station_field.surql',
];

const stripComments = (sql) =>
  sql
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed.toUpperCase() === 'OPTION IMPORT;') return '';
      return line;
    })
    .join('\n');

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function tryQuery(db, statement) {
  try {
    await db.query(statement);
    console.log(`  ok: ${statement.slice(0, 70)}`);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/already exists|already defined/i.test(msg)) {
      console.log(`  skip (exists): ${statement.slice(0, 70)}`);
      return;
    }
    throw err;
  }
}

async function main() {
  console.log(`Bootstrapping ASI/Resort fields on ${url} -> ${ns}/${dbName}`);
  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  for (const file of FILES) {
    const filePath = path.join(root, 'migrations', file);
    const raw = fs.readFileSync(filePath, 'utf8');
    const statements = splitStatements(stripComments(raw));
    console.log(`Applying ${file} (${statements.length} statements)...`);
    for (const statement of statements) {
      await tryQuery(db, statement);
    }
  }

  console.log('Done.');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
