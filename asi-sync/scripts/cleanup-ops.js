'use strict';

/**
 * Operational DB cleanup for POSR (Surreal).
 * KEEPS: users, roles, settings, taxes, payment types, printers, order types,
 *        live ASI menu/categories/menus, live floors/tables, live kitchens,
 *        in-house ASI guests, discounts/coupons master, integrations secrets.
 * WIPES: orders & related, closings/shifts/tips ops, soft-deleted catalog junk,
 *        table locks.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { connectSurreal, queryRows } = require('../src/surreal');
const { config } = require('../src/config');

function log(msg, extra) {
  if (extra !== undefined) console.log(msg, extra);
  else console.log(msg);
}

async function count(db, sql) {
  const rows = await queryRows(db, sql);
  return Number(rows[0]?.n ?? rows[0]?.count ?? 0);
}

async function tryDelete(db, sql, label) {
  try {
    await queryRows(db, sql);
    log(`  OK  ${label}`);
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    if (/does not exist|not found/i.test(msg)) {
      log(`  skip ${label} (missing table)`);
      return false;
    }
    console.warn(`  FAIL ${label}:`, msg.slice(0, 200));
    return false;
  }
}

async function main() {
  log('Connecting…', { url: config.surreal.url });
  const db = await connectSurreal(config.surreal);

  try {
    log('\n=== BEFORE ===');
    const before = {
      orders: await count(db, `SELECT count() AS n FROM \`order\` GROUP ALL`),
      orderItems: await count(db, `SELECT count() AS n FROM order_item GROUP ALL`),
      softMenu: await count(
        db,
        `SELECT count() AS n FROM menu_item WHERE deleted_at != NONE GROUP ALL`,
      ),
      softTables: await count(
        db,
        `SELECT count() AS n FROM floor_table WHERE deleted_at != NONE GROUP ALL`,
      ),
      softKitchens: await count(
        db,
        `SELECT count() AS n FROM kitchen WHERE deleted_at != NONE GROUP ALL`,
      ),
      users: await count(db, `SELECT count() AS n FROM user GROUP ALL`),
      settings: await count(db, `SELECT count() AS n FROM setting GROUP ALL`),
      liveMenu: await count(
        db,
        `SELECT count() AS n FROM menu_item WHERE deleted_at = NONE OR deleted_at = NULL GROUP ALL`,
      ),
      liveTables: await count(
        db,
        `SELECT count() AS n FROM floor_table WHERE deleted_at = NONE OR deleted_at = NULL GROUP ALL`,
      ),
      liveKitchens: await count(
        db,
        `SELECT count() AS n FROM kitchen WHERE deleted_at = NONE OR deleted_at = NULL GROUP ALL`,
      ),
      guests: await count(db, `SELECT count() AS n FROM customer GROUP ALL`),
    };
    console.log(before);

    log('\n=== WIPE operational (orders & related) ===');
    // Child tables first where FK-ish refs matter for Surreal SCHEMAFULL
    const ops = [
      ['order_item_kitchen', 'DELETE order_item_kitchen'],
      ['order_void', 'DELETE order_void'],
      ['order_refund', 'DELETE order_refund'],
      ['order_print', 'DELETE order_print'],
      ['order_tax', 'DELETE order_tax'],
      ['order_discount', 'DELETE order_discount'],
      ['order_coupon', 'DELETE order_coupon'],
      ['order_extras', 'DELETE order_extras'],
      ['order_meta', 'DELETE order_meta'],
      ['order_merge', 'DELETE order_merge'],
      ['order_split', 'DELETE order_split'],
      ['order_payment', 'DELETE order_payment'],
      ['order_item', 'DELETE order_item'],
      ['order', 'DELETE `order`'],
      ['coupon_redemption', 'DELETE coupon_redemption'],
      ['day_closing', 'DELETE day_closing'],
      ['shift', 'DELETE shift'],
      ['time_entry', 'DELETE time_entry'],
      ['tip_distribution_user_share', 'DELETE tip_distribution_user_share'],
      ['tip_distribution', 'DELETE tip_distribution'],
      ['payment_webhook', 'DELETE payment_webhook'],
      ['integration_queue_attempts', 'DELETE integration_queue_attempts'],
      ['integration_queue', 'DELETE integration_queue'],
      ['integration_execution_history', 'DELETE integration_execution_history'],
      ['integration_order_fiscal', 'DELETE integration_order_fiscal'],
    ];
    for (const [label, sql] of ops) {
      await tryDelete(db, sql, label);
    }

    log('\n=== Unlock tables ===');
    await tryDelete(
      db,
      `UPDATE floor_table SET is_locked = false, locked_at = NONE, locked_by = NONE
       WHERE is_locked = true OR locked_at != NONE OR locked_by != NONE`,
      'floor_table unlock',
    );

    log('\n=== Hard-delete soft-deleted junk (keep live ASI catalog / stations / tables) ===');
    await tryDelete(
      db,
      `DELETE menu_item WHERE deleted_at != NONE`,
      'soft-deleted menu_item',
    );
    await tryDelete(
      db,
      `DELETE category WHERE deleted_at != NONE`,
      'soft-deleted category',
    );
    await tryDelete(
      db,
      `DELETE floor_table WHERE deleted_at != NONE`,
      'soft-deleted floor_table',
    );
    await tryDelete(
      db,
      `DELETE kitchen WHERE deleted_at != NONE`,
      'soft-deleted kitchen',
    );
    await tryDelete(
      db,
      `DELETE kitchen WHERE id IN [kitchen:station_cuisine, kitchen:station_bar]`,
      'legacy kitchen:station_*',
    );
    await tryDelete(
      db,
      `DELETE menu WHERE deleted_at != NONE`,
      'soft-deleted menu',
    );
    await tryDelete(
      db,
      `DELETE menu_menu_item WHERE deleted_at != NONE`,
      'soft-deleted menu_menu_item',
    );

    // Orphan menu_menu_item pointing at deleted dishes
    await tryDelete(
      db,
      `DELETE menu_menu_item WHERE menu_item.deleted_at != NONE`,
      'orphan menu_menu_item (deleted dish)',
    );

    log('\n=== Remove demo floors / non-ASI catalog (keep ASI + Salle) ===');
    await tryDelete(
      db,
      `DELETE floor_table WHERE source = NONE OR source = NULL OR source IS NONE`,
      'non-ASI floor_table',
    );
    await tryDelete(
      db,
      `DELETE floor WHERE id != floor:resort_salle AND name != 'Salle'`,
      'demo floors (not Salle)',
    );
    await tryDelete(
      db,
      `DELETE menu_menu_item WHERE menu != menu:asi_restaurant`,
      'non-ASI menu links',
    );
    await tryDelete(
      db,
      `DELETE menu WHERE id != menu:asi_restaurant`,
      'non-ASI menus',
    );
    await tryDelete(
      db,
      `DELETE menu_item WHERE source = NONE OR source = NULL OR source IS NONE`,
      'non-ASI menu_item',
    );
    await tryDelete(
      db,
      `DELETE category WHERE source = NONE OR source = NULL OR source IS NONE`,
      'non-ASI category',
    );
    await tryDelete(
      db,
      `UPDATE setting SET values = [menu:asi_restaurant] WHERE key = 'menus' AND is_global = true`,
      'settings menus → ASI only',
    );

    log('\n=== AFTER ===');
    const after = {
      orders: await count(db, `SELECT count() AS n FROM \`order\` GROUP ALL`),
      orderItems: await count(db, `SELECT count() AS n FROM order_item GROUP ALL`),
      softMenu: await count(
        db,
        `SELECT count() AS n FROM menu_item WHERE deleted_at != NONE GROUP ALL`,
      ),
      softTables: await count(
        db,
        `SELECT count() AS n FROM floor_table WHERE deleted_at != NONE GROUP ALL`,
      ),
      softKitchens: await count(
        db,
        `SELECT count() AS n FROM kitchen WHERE deleted_at != NONE GROUP ALL`,
      ),
      users: await count(db, `SELECT count() AS n FROM user GROUP ALL`),
      settings: await count(db, `SELECT count() AS n FROM setting GROUP ALL`),
      liveMenu: await count(
        db,
        `SELECT count() AS n FROM menu_item WHERE deleted_at = NONE OR deleted_at = NULL GROUP ALL`,
      ),
      liveTables: await count(
        db,
        `SELECT count() AS n FROM floor_table WHERE deleted_at = NONE OR deleted_at = NULL GROUP ALL`,
      ),
      liveKitchens: await count(
        db,
        `SELECT count() AS n FROM kitchen WHERE deleted_at = NONE OR deleted_at = NULL GROUP ALL`,
      ),
      guests: await count(db, `SELECT count() AS n FROM customer GROUP ALL`),
      taxes: await count(db, `SELECT count() AS n FROM tax GROUP ALL`),
      paymentTypes: await count(db, `SELECT count() AS n FROM payment_type GROUP ALL`),
    };
    console.log(after);

    const kitchens = await queryRows(
      db,
      `SELECT id, name, station, priority FROM kitchen
       WHERE deleted_at = NONE OR deleted_at = NULL
       ORDER BY priority ASC`,
    );
    log('Live kitchens:', kitchens.map((k) => `${k.name}(${k.station || '-'})`).join(', '));

    log('\nKept sensitive/config: users, settings, taxes, payment types, live menu/tables/kitchens, guests.');
  } finally {
    if (typeof db.close === 'function') await db.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
