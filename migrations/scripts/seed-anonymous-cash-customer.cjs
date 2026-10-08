#!/usr/bin/env node
'use strict';

/**
 * Ensures the shared anonymous-cash walk-in is the existing customer named CASH.
 * If customer:libre_anonymes_cash still exists as a separate record, merges it into CASH.
 *
 *   node migrations/scripts/seed-anonymous-cash-customer.cjs
 *
 * Credentials: SURREAL_USER / SURREAL_PASS from ./.env (or the environment).
 */

const fs = require('fs');
const path = require('path');
const WS = require('ws');
const { Surreal } = require('surrealdb');

const ROOT = path.join(__dirname, '..', '..');
try {
  require(path.join(ROOT, 'asi-sync', 'node_modules', 'dotenv')).config({
    path: path.join(ROOT, '.env'),
  });
} catch {
  // dotenv optional when env vars are already set
}

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

const rows = (result) => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? first : [];
};

async function main() {
  const db = new Surreal();
  await db.connect(DB_URL);
  await db.signin({ username: DB_USER, password: DB_PASS });
  await db.use({ namespace: DB_NS, database: DB_NAME });

  const sql = fs.readFileSync(
    path.join(ROOT, 'migrations', '2026_10_08_anonymous_cash_customer.surql'),
    'utf8',
  );
  await db.query(sql);

  const cash = rows(
    await db.query(
      `SELECT id, name, number, guest_code, tags, notes, deleted_at, merged_into
       FROM customer
       WHERE deleted_at = NONE AND merged_into = NONE
         AND string::uppercase(name ?? '') = 'CASH'
       LIMIT 1`,
    ),
  )[0];
  const libre = rows(
    await db.query(
      `SELECT id, name, number, deleted_at, merged_into FROM customer:libre_anonymes_cash`,
    ),
  )[0];

  console.log('CASH', cash ? JSON.stringify(cash, null, 2) : '(missing)');
  console.log('libre_anonymes_cash', libre ? JSON.stringify(libre, null, 2) : '(none)');
  if (cash) {
    const num =
      typeof cash.number === 'number' ? `C-${String(cash.number).padStart(6, '0')}` : '';
    console.log(`OK keep ${cash.id} "${cash.name}" ${num}`);
  }

  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
