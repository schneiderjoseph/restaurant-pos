'use strict';

/**
 * Clean isolated Surreal loyverse/loyverse for a fresh sync.
 * KEEPS: user, user_role (login).
 * REMOVES: catalogue / customers / payments / discounts / menus / settings / ops junk.
 *
 * Never touches posr/posr.
 *
 *   node loyverse-sync/scripts/clean-loyverse-db.js
 *   node loyverse-sync/scripts/clean-loyverse-db.js --resync
 */

const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const WS = require('ws');
const { Surreal } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') global.WebSocket = WS;

const url = process.env.SURREAL_URL || 'ws://127.0.0.1:8001/rpc';
const ns = process.env.LOYVERSE_SURREAL_NS || 'loyverse';
const dbName = process.env.LOYVERSE_SURREAL_DB || 'loyverse';
const user = process.env.SURREAL_USER || 'posr';
const pass = process.env.SURREAL_PASS || 'posr-local-dev-change-me';
const doResync = process.argv.includes('--resync');

const KEEP = new Set(['user', 'user_role']);

/** Tables we always wipe in the Loyverse sandbox (if they exist). */
const WIPE = [
  'menu_menu_item',
  'menu_menu_item_tax',
  'menu_item_modifier_group',
  'menu_item_recipe',
  'menu_item',
  'menu',
  'category',
  'tax',
  'customer',
  'customer_address',
  'payment_type',
  'payment_type_gateway_config',
  'discount',
  'discount_reason',
  'modifier',
  'modifier_group',
  'setting',
  'kitchen',
  'floor',
  'floor_table',
  'order',
  'order_item',
  'order_payment',
  'order_type',
  'cart',
  'document',
];

async function q(db, sql, vars) {
  const result = await db.query(sql, vars);
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first) ? first : first != null ? [first] : [];
}

async function tableExists(db, name) {
  try {
    await db.query(`SELECT * FROM ${name} LIMIT 1`);
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/does not exist|not found/i.test(msg)) return false;
    return true;
  }
}

async function countOf(db, name) {
  try {
    const rows = await q(db, `SELECT count() AS c FROM ${name} GROUP ALL`);
    return Number(rows[0]?.c) || 0;
  } catch {
    return -1;
  }
}

async function main() {
  if (ns === 'posr' && dbName === 'posr') {
    throw new Error('Refusing to clean posr/posr');
  }

  console.log(`Cleaning ${url} → ${ns}/${dbName} (keep: ${[...KEEP].join(', ')})`);
  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  const beforeUsers = await countOf(db, 'user');
  const beforeRoles = await countOf(db, 'user_role');
  console.log(`Before: users=${beforeUsers} user_roles=${beforeRoles}`);

  const wiped = {};
  for (const table of WIPE) {
    if (KEEP.has(table)) continue;
    if (!(await tableExists(db, table))) {
      wiped[table] = 'missing';
      continue;
    }
    const before = await countOf(db, table);
    try {
      await db.query(`DELETE ${table}`);
      wiped[table] = before;
    } catch (err) {
      wiped[table] = `fail: ${err.message}`;
    }
  }

  // Also remove any leftover fixed menu ids
  for (const id of ['menu:loyverse_catalog', 'menu:asi_restaurant']) {
    try {
      await db.query(`DELETE ${id}`);
    } catch {
      // ignore
    }
  }

  const afterUsers = await countOf(db, 'user');
  const afterRoles = await countOf(db, 'user_role');
  console.log('Wiped:', wiped);
  console.log(`After: users=${afterUsers} user_roles=${afterRoles}`);

  if (afterUsers === 0) {
    console.warn('WARNING: no users left — re-run copy-users-from-posr.js');
  }

  await db.close();

  if (doResync) {
    console.log('Re-syncing from Loyverse API…');
    const r = spawnSync('npm', ['run', 'once'], {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      shell: true,
    });
    process.exit(r.status || 0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
