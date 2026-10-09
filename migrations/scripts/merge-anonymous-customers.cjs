#!/usr/bin/env node
'use strict';

/**
 * Folds the walk-ins registered under a name that names nobody ("Cash", "Cash Couple",
 * "Client", "Passant"…) into the shared CASH customer (tag `anonymous`,
 * 2026_10_08_anonymous_cash_customer.surql): each is marked merged and its orders move to CASH,
 * so they count on the anonymous row of the Sales by customer report.
 * Rooms typed as a name ("Ch-21") and made-up phones are only listed: they are real guests.
 *
 * Same rules as placeholderGuestName / isPlaceholderPhone (src/lib/guest.ts, src/lib/phone.ts).
 * Dry run unless --apply.
 *
 *   node migrations/scripts/merge-anonymous-customers.cjs [--apply]
 *
 * Credentials: SURREAL_USER / SURREAL_PASS from ./.env (or the environment).
 */

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

const APPLY = process.argv.includes('--apply');
const DB_URL = process.env.SURREAL_URL || 'ws://localhost:8000/rpc';
const DB_NS = process.env.SURREAL_NS || 'posr';
const DB_NAME = process.env.SURREAL_DB || 'posr';
const DB_USER = process.env.SURREAL_USER;
const DB_PASS = process.env.SURREAL_PASS;
if (!DB_USER || !DB_PASS) {
  console.error('ERROR: SURREAL_USER and SURREAL_PASS env vars are required.');
  process.exit(1);
}

const ANONYMOUS_NAME_WORDS = new Set([
  'CASH', 'ANONYME', 'ANONYMES', 'ANONYMOUS', 'ANON', 'PASSANT', 'PASSANTS', 'PASSANTE',
  'WALKIN', 'INCONNU', 'INCONNUE', 'UNKNOWN',
]);
const FILLER_NAME_WORDS = new Set([
  'CLIENT', 'CLIENTS', 'CLIENTE', 'GUEST', 'CUSTOMER', 'TEST', 'WALK', 'IN', 'DIVERS',
  'COMPTOIR', 'BAR', 'NA', 'NN', 'NONE', 'AUCUN', 'MR', 'MME', 'MONSIEUR', 'MADAME',
]);
const ROOM_AS_NAME = /^(CH|CHB|CHAMBRE|ROOM|RM|SUITE)\s*[-#.:]?\s*\d+[A-Z]?$/;

const placeholderName = (name) => {
  const raw = String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  if (ROOM_AS_NAME.test(raw)) return 'room';
  const words = raw.split(/[^A-Z0-9]+/).filter((word) => word && !/^\d+$/.test(word));
  if (words.length === 0) return null;
  if (words.some((word) => ANONYMOUS_NAME_WORDS.has(word))) return 'anonymous';
  if (words.every((word) => FILLER_NAME_WORDS.has(word) || /^X+$/.test(word))) return 'anonymous';
  return null;
};

/** National digits: "+509 2121 2121" → "21212121". */
const nationalDigits = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('509')) return digits.slice(3);
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
};
const placeholderPhone = (phone) => {
  const national = nationalDigits(phone);
  return national.length >= 6 && (
    new Set(national).size <= 2 ||
    '01234567890123456789'.includes(national) ||
    '98765432109876543210'.includes(national)
  );
};

const rows = (result) => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? first : [];
};
const label = (c) => `${String(c.id)} "${c.name ?? ''}"${c.phone ? ` ${c.phone}` : ''}`;

async function main() {
  const db = new Surreal();
  await db.connect(DB_URL);
  await db.signin({ username: DB_USER, password: DB_PASS });
  await db.use({ namespace: DB_NS, database: DB_NAME });

  const cash = rows(await db.query(
    `SELECT id, name FROM customer
     WHERE deleted_at = NONE AND merged_into = NONE AND (tags ?? []) CONTAINS 'anonymous'
     LIMIT 1`,
  ))[0];
  if (!cash) {
    console.error('ERROR: no CASH customer tagged anonymous. Run seed-anonymous-cash-customer.cjs first.');
    process.exit(1);
  }
  console.log(`CASH = ${label(cash)}`);

  const customers = rows(await db.query(
    `SELECT id, name, phone, tags FROM customer
     WHERE deleted_at = NONE AND merged_into = NONE AND source != 'asi'`,
  ));
  const anonymous = customers.filter((c) =>
    String(c.id) !== String(cash.id) && placeholderName(c.name) === 'anonymous');
  const rooms = customers.filter((c) => placeholderName(c.name) === 'room');
  const fakePhones = customers.filter((c) =>
    placeholderName(c.name) === null && placeholderPhone(c.phone));

  const orderCounts = new Map(rows(await db.query(
    `SELECT customer, count() AS n FROM order WHERE customer IN $ids GROUP BY customer`,
    { ids: anonymous.map((c) => c.id) },
  )).map((row) => [String(row.customer), row.n]));

  console.log(`\nTo fold into CASH (${anonymous.length}):`);
  for (const c of anonymous) {
    console.log(`  ${label(c)} — ${orderCounts.get(String(c.id)) ?? 0} order(s)`);
  }
  console.log(`\nRoom typed as a name, left as is (${rooms.length}):`);
  for (const c of rooms) console.log(`  ${label(c)}`);
  console.log(`\nMade-up phone, left as is (${fakePhones.length}):`);
  for (const c of fakePhones) console.log(`  ${label(c)}`);

  if (!APPLY) {
    console.log('\nDry run: nothing changed. Run again with --apply.');
    await db.close();
    return;
  }

  for (const c of anonymous) {
    await db.query(
      `BEGIN TRANSACTION;
       UPDATE $drop SET merged_into = $keep, deleted_at = time::now(), deleted_reason = 'merged';
       UPDATE customer SET merged_into = $keep WHERE merged_into = $drop;
       UPDATE order SET customer = $keep WHERE customer = $drop;
       COMMIT TRANSACTION;`,
      { drop: c.id, keep: cash.id },
    );
    console.log(`merged ${label(c)}`);
  }
  console.log(`\nDone: ${anonymous.length} customer(s) folded into CASH.`);
  await db.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
