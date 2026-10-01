'use strict';

/**
 * Seed default order types on a fresh POS DB.
 *
 * `order.order_type` is a required `record<order_type>`, and the POS picks
 * `settings.order_types[0]` as the default. A fresh database (latest.surql +
 * incrementals) has zero `order_type` rows, so every "send order" fails with
 * "Couldn't coerce value for field `order_type`... found `NULL`", and the
 * Loyverse sync skips every receipt.
 *
 * No-op if a non-deleted `order_type` already exists - rename or add more from
 * Admin -> Order types inside the app.
 *
 * Env: SURREAL_URL, SURREAL_NS (default posr), SURREAL_DB (default posr),
 *      SURREAL_USER, SURREAL_PASS
 *
 * Usage (repo root): node migrations/scripts/bootstrap-order-types.cjs
 */

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

// Service charges stay off: turning them on is a business decision made in Admin.
const DEFAULT_ORDER_TYPES = [
  { name: 'Sur place', priority: 1 },
  { name: 'À emporter', priority: 2 },
];

function firstRow(result) {
  const top = Array.isArray(result) ? result[0] : result;
  if (Array.isArray(top)) return top[0] ?? null;
  return top ?? null;
}

async function main() {
  console.log(`Seeding default order types on ${url} -> ${ns}/${dbName}`);

  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  const existing = await db.query(
    'SELECT count() FROM order_type WHERE deleted_at = NONE GROUP ALL'
  );
  const count = firstRow(existing)?.count ?? 0;
  if (count > 0) {
    console.log(
      `${count} order type(s) already exist - nothing to seed. Manage them from Admin -> Order types.`
    );
    await db.close();
    return;
  }

  for (const type of DEFAULT_ORDER_TYPES) {
    await db.query(
      `CREATE order_type SET
         name = $name,
         priority = $priority,
         allow_service_charges = false,
         deleted_at = NONE`,
      type
    );
    console.log(`  created order type "${type.name}"`);
  }

  console.log('Done. Reload the POS cache so the terminals pick them up.');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
