'use strict';

/**
 * Read-only audit of customer identities, to run before
 * migrations/2026_10_06_customer_management.surql makes the ID document unique.
 *
 * Reports:
 *   - active customers sharing an ID document number (blocks the UNIQUE index)
 *   - customers sharing a phone number (allowed: a family shares a phone)
 *   - homonyms (allowed: the name never identifies a customer)
 *   - phones that do not normalize to a usable number
 *
 * Usage:
 *   SURREAL_USER=... SURREAL_PASS=... node migrations/scripts/audit-customer-duplicates.cjs
 */

const WS = require('ws');
const { Surreal } = require('surrealdb');
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

const digits = (value) => (value == null ? '' : String(value).replace(/\D/g, ''));
const nameKey = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .sort()
    .join(' ');

const groupBy = (list, key) => {
  const groups = new Map();
  for (const item of list) {
    const k = key(item);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return [...groups.entries()].filter(([, items]) => items.length > 1);
};

const label = (c) => `${String(c.id)} "${c.name ?? ''}" (${c.source ?? 'local'})`;

async function main() {
  const db = new Surreal();
  await db.connect(DB_URL);
  await db.signin({ username: DB_USER, password: DB_PASS });
  await db.use({ namespace: DB_NS, database: DB_NAME });

  const customers = rows(
    await db.query(
      `SELECT id, name, phone, id_document_number, source, asi_guest_id, deleted_at FROM customer`,
    ),
  );
  const active = customers.filter((c) => c.deleted_at == null);
  console.log(`customers: ${customers.length} (active ${active.length})`);

  // A guest's ASI stays are separate records of one person: same ID across stays is expected.
  const person = (c) => (c.asi_guest_id != null ? `asi:${c.asi_guest_id}` : String(c.id));

  const idDupes = groupBy(active, (c) => c.id_document_number || '')
    .filter(([, items]) => new Set(items.map(person)).size > 1);
  console.log(`\n== ID document shared by different customers: ${idDupes.length} (must be fixed before the migration)`);
  for (const [number, items] of idDupes) {
    console.log(`  ${number}: ${items.map(label).join(' | ')}`);
  }

  const phoneDupes = groupBy(active, (c) => {
    const d = digits(c.phone);
    return d.length >= 6 ? d.slice(-8) : '';
  }).filter(([, items]) => new Set(items.map(person)).size > 1);
  console.log(`\n== Phone shared (allowed): ${phoneDupes.length}`);
  for (const [phone, items] of phoneDupes.slice(0, 30)) {
    console.log(`  …${phone}: ${items.map(label).join(' | ')}`);
  }

  const homonyms = groupBy(active, (c) => nameKey(c.name))
    .filter(([, items]) => new Set(items.map(person)).size > 1);
  console.log(`\n== Homonyms (allowed): ${homonyms.length}`);
  for (const [name, items] of homonyms.slice(0, 30)) {
    console.log(`  ${name}: ${items.length} customers`);
  }

  const badPhones = active.filter((c) => c.phone != null && c.phone !== '' && digits(c.phone).length < 6);
  console.log(`\n== Phones too short to be a number: ${badPhones.length}`);
  for (const c of badPhones.slice(0, 30)) {
    console.log(`  ${label(c)} phone=${JSON.stringify(c.phone)}`);
  }

  await db.close();
  process.exit(idDupes.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
