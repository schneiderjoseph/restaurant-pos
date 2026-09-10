'use strict';

/**
 * Bootstrap a FRESH posr/posr SurrealDB from scratch:
 *   1. migrations/latest.surql        -> full base schema (143 tables), OPTION IMPORT
 *   2. post-latest.surql migrations    -> tables/fields added after the snapshot
 *   3. ASI / Resort F&B field migrations
 *
 * This is the fresh-install path. run-prod-migrations.cjs is the *upgrade* path
 * for an existing DB and hard-fails on an empty one (its plan starts before
 * latest.surql and ALTERs tables that don't exist yet).
 *
 * Safe to re-run: latest.surql uses OPTION IMPORT; the incrementals are applied
 * statement-by-statement and "already exists / already defined" is treated as
 * already-applied (skip).
 *
 * Env: SURREAL_URL, SURREAL_NS (default posr), SURREAL_DB (default posr),
 *      SURREAL_USER, SURREAL_PASS
 *
 * Usage (repo root): node migrations/scripts/bootstrap-posr-db.cjs
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

// Migrations added AFTER migrations/latest.surql's snapshot (2026-08-24) that
// are NOT Loyverse-specific. Applied on top of latest.surql. Order = ship order.
const POST_LATEST = [
  '2026_08_27_revoked_session_store.surql',
  '2026_08_27_payment_credential_encryption.surql',
  '2026_08_28_audit_log_events.surql',
  '2026_08_28_security_alerts.surql',
  '2026_08_30_hot_path_indexes.surql',
];

// ASI / Resort F&B field migrations. resort_customer_pms first (base customer
// fields) then asi_guest_fields OVERWRITEs them with the full ASI FD mapping.
const ASI_FILES = [
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
      const t = line.trim();
      if (t.startsWith('--')) return '';
      return line;
    })
    .join('\n');

function splitStatements(sql) {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => s.toUpperCase() !== 'OPTION IMPORT');
}

const IGNORABLE = /already exists|already defined|already contains/i;

async function applyFileWhole(db, rel) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const sql = stripComments(raw).trim();
  console.log(`Applying ${rel} (whole file)...`);
  await db.query(sql);
  console.log(`  done ${rel}`);
}

async function applyFileStatements(db, rel) {
  const raw = fs.readFileSync(path.join(root, rel), 'utf8');
  const statements = splitStatements(stripComments(raw));
  console.log(`Applying ${rel} (${statements.length} statements)...`);
  for (const stmt of statements) {
    try {
      await db.query(stmt);
      console.log(`  ok: ${stmt.slice(0, 70)}`);
    } catch (err) {
      const msg = String(err?.message || err);
      if (IGNORABLE.test(msg)) {
        console.log(`  skip (exists): ${stmt.slice(0, 70)}`);
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  console.log(`Bootstrapping fresh posr DB on ${url} -> ${ns}/${dbName}`);
  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  await applyFileWhole(db, 'migrations/latest.surql');

  // POST_LATEST files are 100% `DEFINE ... IF NOT EXISTS / OVERWRITE` and some
  // contain `DEFINE EVENT ... THEN { ...; ... }` blocks, so apply them whole
  // (splitting on ';' would shatter the event bodies).
  for (const f of POST_LATEST) {
    await applyFileWhole(db, `migrations/${f}`);
  }
  // ASI files are plain `DEFINE FIELD/INDEX` (no blocks, no IF NOT EXISTS) -
  // apply statement-by-statement so a re-run skips the ones already there.
  for (const f of ASI_FILES) {
    await applyFileStatements(db, `migrations/${f}`);
  }

  console.log('Done - posr/posr schema is ready.');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
