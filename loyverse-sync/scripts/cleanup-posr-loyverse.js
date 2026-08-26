'use strict';

/**
 * One-shot: remove Loyverse pollution from the ASI/native Surreal (posr/posr)
 * and restore menu:asi_restaurant as the active menus setting.
 *
 * Does NOT delete ASI data.
 *
 * Usage (from repo root):
 *   NODE_PATH=./loyverse-sync/node_modules node loyverse-sync/scripts/cleanup-posr-loyverse.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const WS = require('ws');
const { Surreal, StringRecordId } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') global.WebSocket = WS;

const url = process.env.CLEANUP_SURREAL_URL || process.env.SURREAL_URL || 'ws://127.0.0.1:8001/rpc';
const ns = process.env.CLEANUP_SURREAL_NS || 'posr';
const dbName = process.env.CLEANUP_SURREAL_DB || 'posr';
const user = process.env.SURREAL_USER || 'posr';
const pass = process.env.SURREAL_PASS || 'posr-local-dev-change-me';

async function q(db, sql, vars) {
  const result = await db.query(sql, vars);
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first) ? first : first != null ? [first] : [];
}

async function main() {
  console.log(`Cleaning Loyverse rows from ${url} ${ns}/${dbName} …`);
  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  const soft = async (table) => {
    const rows = await q(
      db,
      `UPDATE ${table} SET deleted_at = time::now()
       WHERE source = 'loyverse'
         AND (deleted_at = NONE OR deleted_at = NULL)
       RETURN AFTER`,
    );
    return rows.length;
  };

  const cats = await soft('category');
  const items = await soft('menu_item');
  const taxes = await soft('tax');
  const customers = await soft('customer');
  const payments = await soft('payment_type');
  const discounts = await soft('discount');

  // Drop Loyverse menu link rows then soft-delete the menu
  const menuRows = await q(db, `SELECT items FROM menu:loyverse_catalog`);
  const prevItems = Array.isArray(menuRows[0]?.items) ? menuRows[0].items : [];
  for (const mid of prevItems) {
    try {
      await q(db, `DELETE $id`, { id: new StringRecordId(String(mid)) });
    } catch {
      // ignore
    }
  }
  await q(
    db,
    `UPDATE menu:loyverse_catalog SET items = [], active = false, deleted_at = time::now()`,
  );

  // Restore ASI menu selection if ASI menu exists
  const asi = await q(db, `SELECT id FROM menu:asi_restaurant WHERE deleted_at = NONE OR deleted_at = NULL`);
  if (asi[0]?.id) {
    const settings = await q(
      db,
      `SELECT id FROM setting WHERE key = 'menus' AND is_global = true LIMIT 1`,
    );
    const asiRef = new StringRecordId('menu:asi_restaurant');
    if (settings[0]?.id) {
      await q(db, `UPDATE $id SET values = [$menu]`, {
        id: new StringRecordId(String(settings[0].id)),
        menu: asiRef,
      });
    } else {
      await q(db, `CREATE setting SET key = 'menus', is_global = true, values = [$menu]`, {
        menu: asiRef,
      });
    }
    console.log('Restored setting.menus → menu:asi_restaurant');
  } else {
    console.warn('menu:asi_restaurant not found — left setting.menus unchanged');
  }

  console.log('Soft-deleted Loyverse-sourced rows:', {
    categories: cats,
    menu_items: items,
    taxes,
    customers,
    payment_types: payments,
    discounts,
  });

  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
