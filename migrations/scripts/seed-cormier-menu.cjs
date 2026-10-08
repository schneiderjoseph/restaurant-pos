#!/usr/bin/env node
'use strict';

/**
 * Replaces the ASI-synced catalogue with the Cormier Plage menu
 * (migrations/data/cormier-menu.json) and wipes the test orders.
 *
 * Keeps: users, roles, settings, outlets, stations (kitchen), printers, floors,
 * tables, rooms, customers, payment types, order types and the two taxes.
 *
 *   node migrations/scripts/seed-cormier-menu.cjs            # dry run: prints the SQL
 *   node migrations/scripts/seed-cormier-menu.cjs --apply    # backup, then apply
 *   ... --categories --apply   # re-file dishes into the JSON's categories and fill missing
 *                                descriptions (keeps orders and Manage edits)
 *
 * Options: --url http://127.0.0.1:8000  --ns posr  --db posr  --no-backup
 * Credentials: SURREAL_USER / SURREAL_PASS from ./.env.
 * Turn ASI_MENU_SYNC off in asi-sync/.env first, or the next poll brings ASI back.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, 'asi-sync', 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const CATEGORIES_ONLY = args.includes('--categories');
const URL = opt('url', 'http://127.0.0.1:8000');
const NS = opt('ns', process.env.SURREAL_NS || 'posr');
const DB = opt('db', process.env.SURREAL_DB || 'posr');

const ORDER_TABLES = [
  'order_item_kitchen', 'order_tax', 'order_print', 'order_split', 'order_void',
  'order_edit_request', 'order_discount', 'order_extras', 'order_coupon', 'order_meta',
  'order_refund', 'order_merge', 'order_payment', 'order_item', 'order',
];
const MENU_TABLES = [
  'menu_item_modifier_group', 'modifier_group', 'modifier', 'menu_menu_item_tax',
  'menu_menu_item', 'menu', 'menu_item', 'category',
];
const SIDES_GROUP = 'modifier_group:choix_accompagnement';
const MENU_ID = 'menu:cormier_plage';

const q = (v) => JSON.stringify(v);

const categorySet = (c, ci) =>
  `category:${c.key} SET name = ${q(c.name)}, priority = ${(ci + 1) * 10}, ` +
  `show_in_menu = true, outlet = outlet:${c.outlet}, source = 'manual', deleted_at = NONE`;

/** @returns {Map<string, { id: string, item: any, cats: string[], outlet: string }>} */
function collectDishes(data) {
  const dishes = new Map();
  for (const c of data.categories) {
    for (const it of c.items) {
      if (it.ref) continue;
      dishes.set(`${c.key}::${it.name}`, { id: `menu_item:m${it.number}`, item: it, cats: [c.key], outlet: c.outlet });
    }
  }
  // Refs: the same dish also shows under a second category (weekend plates).
  for (const c of data.categories) {
    for (const it of c.items) {
      if (!it.ref) continue;
      const d = dishes.get(it.ref);
      if (!d) throw new Error(`Unknown dish ref ${it.ref}`);
      d.cats.push(c.key);
    }
  }
  return dishes;
}

/** Description set from the JSON ({ fr, en }), or nothing when the dish has none. */
const descriptionOf = (item) => (item.description ? q(item.description) : null);

/**
 * Categories only: re-files existing dishes and fills descriptions they lack.
 * Leaves dishes, prices, descriptions edited in Manage and orders alone.
 */
function buildCategoriesSql(data) {
  const lines = ['BEGIN TRANSACTION;'];
  const keys = data.categories.map((c) => `category:${c.key}`);
  data.categories.forEach((c, ci) => lines.push(`UPSERT ${categorySet(c, ci)};`));
  const dishes = collectDishes(data);
  for (const d of dishes.values()) {
    const desc = descriptionOf(d.item);
    lines.push(
      `UPDATE ${d.id} SET categories = [${d.cats.map((k) => `category:${k}`).join(', ')}]` +
        (desc ? `, description = description ?? ${desc}` : '') + ';',
    );
  }
  lines.push(`DELETE category WHERE id NOTINSIDE [${keys.join(', ')}];`);
  lines.push('COMMIT TRANSACTION;');
  return { sql: lines.join('\n'), dishCount: dishes.size };
}

function buildSql(data) {
  const lines = ['BEGIN TRANSACTION;'];
  for (const t of ORDER_TABLES) lines.push(`DELETE \`${t}\`;`);
  lines.push('UPDATE order_number_seq SET value = 0;');
  for (const t of MENU_TABLES) lines.push(`DELETE ${t};`);
  lines.push('UPDATE floor_table SET categories = [] WHERE array::len(categories ?? []) > 0;');
  lines.push(`UPDATE ${data.taxes.join(', ')} SET deleted_at = NONE;`);

  data.categories.forEach((c, ci) => {
    lines.push(`CREATE ${categorySet(c, ci)};`);
  });
  const dishes = collectDishes(data);

  let pos = 0;
  const menuItems = [];
  const byOutlet = { restaurant: [], bar: [] };
  for (const d of dishes.values()) {
    pos += 1;
    const n = d.item.number;
    lines.push(
      `CREATE ${d.id} SET name = ${q(d.item.name)}, number = ${q(n)}, price = ${d.item.price.toFixed(2)}f, ` +
        `cost = 0f, priority = ${pos}, source = 'manual', deleted_at = NONE, ` +
        `categories = [${d.cats.map((k) => `category:${k}`).join(', ')}]` +
        (descriptionOf(d.item) ? `, description = ${descriptionOf(d.item)}` : '') + ';',
    );
    lines.push(
      `CREATE menu_menu_item:m${n} SET menu_item = ${d.id}, active = true, tax_mode = 'exclusive', ` +
        `taxes = [${data.taxes.join(', ')}], tax = ${data.taxes[0]};`,
    );
    menuItems.push(`menu_menu_item:m${n}`);
    byOutlet[d.outlet].push(d.id);
  }
  lines.push(
    `CREATE ${MENU_ID} SET name = 'Cormier Plage', active = true, deleted_at = NONE, items = [${menuItems.join(', ')}];`,
  );
  lines.push(`UPDATE setting SET values = [${MENU_ID}] WHERE key = 'menus' AND is_global = true;`);
  for (const [outlet, ids] of Object.entries(byOutlet)) {
    lines.push(
      `UPDATE kitchen SET items = [${ids.join(', ')}], shows_all = false ` +
        `WHERE outlet = outlet:${outlet} AND deleted_at = NONE;`,
    );
  }

  // Side choice: one required, first one free, on mains (categories flagged sides).
  const sides = data.categories.find((c) => c.key === 'supplements');
  const modIds = sides.items.filter((it) => !/acras/i.test(it.name)).map((it) => {
    lines.push(`CREATE modifier:side_${it.number} SET modifier = menu_item:m${it.number}, price = 0f;`);
    return `modifier:side_${it.number}`;
  });
  lines.push(
    `CREATE ${SIDES_GROUP} SET name = 'Choix accompagnement', priority = 0, ` +
      `free_modifier_rule = 'first', modifiers = [${modIds.join(', ')}];`,
  );
  for (const c of data.categories.filter((x) => x.sides)) {
    for (const it of c.items) {
      if (it.ref) continue;
      lines.push(
        `RELATE menu_item:m${it.number}->menu_item_modifier_group->${SIDES_GROUP} SET ` +
          'has_required_modifiers = true, required_modifiers = 1, included_modifiers = 1, ' +
          'should_auto_open = true, should_auto_select = false, priority = 0;',
      );
    }
  }
  lines.push('COMMIT TRANSACTION;');
  return { sql: lines.join('\n'), dishCount: dishes.size };
}

function headers(accept = 'application/json') {
  const auth = Buffer.from(`${process.env.SURREAL_USER}:${process.env.SURREAL_PASS}`).toString('base64');
  return { Authorization: `Basic ${auth}`, 'surreal-ns': NS, 'surreal-db': DB, Accept: accept };
}

async function sql(body) {
  const res = await fetch(`${URL}/sql`, { method: 'POST', headers: headers(), body });
  const json = await res.json();
  if (!res.ok || !Array.isArray(json)) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  const bad = json.find((r) => r.status !== 'OK');
  if (bad) throw new Error(`Query failed: ${JSON.stringify(bad.result).slice(0, 500)}`);
  return json;
}

async function backup() {
  const res = await fetch(`${URL}/export`, { headers: headers('text/plain') });
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status}`);
  const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'posr-backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${NS}-${DB}-before-menu-reset-${new Date().toISOString().replace(/[:.]/g, '-')}.surql`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations', 'data', 'cormier-menu.json'), 'utf8'));
  const { sql: script, dishCount } = CATEGORIES_ONLY ? buildCategoriesSql(data) : buildSql(data);

  if (!APPLY) {
    console.log(script);
    console.error(`\n-- dry run: ${data.categories.length} categories, ${dishCount} dishes. Add --apply to run on ${NS}/${DB}.`);
    return;
  }
  if (!args.includes('--no-backup')) console.log('Backup →', await backup());
  await sql(script);

  const [cats, items, orders, kitchens] = await sql(
    'SELECT count() FROM category GROUP ALL; SELECT count() FROM menu_item GROUP ALL; ' +
      'SELECT count() FROM order GROUP ALL; SELECT name, array::len(items) AS dishes FROM kitchen;',
  ).then((r) => r.map((x) => x.result));
  console.log(`OK ${NS}/${DB}: ${cats[0]?.count ?? 0} catégories, ${items[0]?.count ?? 0} plats, ${orders[0]?.count ?? 0} commandes`);
  console.log('Stations:', kitchens.map((k) => `${k.name}=${k.dishes}`).join(', '));
  console.log('Sur chaque appareil : Settings → Reload cache (ou recharger la page).');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
