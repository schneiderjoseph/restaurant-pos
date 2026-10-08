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
 *   ... --variants --apply     # bar formats folded into one dish with variants (Shot / Bouteille),
 *                                "par oz" dishes sold by measure. Keeps orders; variant prices are
 *                                read from the live dishes they replace, so Manage edits stay.
 *                                Needs migrations/2026_10_08_dish_variants_measure.surql.
 *   ... --add --apply          # create the outlets, categories and dishes the DB lacks (e.g. the
 *                                Plage passes). Changes nothing existing, keeps orders.
 *   ... --sides --apply        # side choices on their own short-named dishes ("Frites"), the
 *                                Supplements plates keep their names. Keeps orders.
 *
 * Plage (beach passes, from the ASI PLAGE group, POS BAR prices): own outlet, untaxed like in
 * ASI, and on no station, so they print on bills and pre-bills only, never on a KDS / KOT.
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
const VARIANTS_ONLY = args.includes('--variants');
const ADD_ONLY = args.includes('--add');
const SIDES_ONLY = args.includes('--sides');
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
  `show_in_menu = ${c.hidden ? 'false' : 'true'}, outlet = outlet:${c.outlet}, source = 'manual', deleted_at = NONE`;

/**
 * Side choices: their own dishes ("Frites"), off the menu, filed under the hidden
 * Accompagnements category, so renaming them never renames the Supplements plate
 * ("Plat de frites") sold on its own.
 */
const SIDES_CATEGORY = 'category:accompagnements';
const sideItems = (data) => data.categories.find((c) => c.key === 'supplements').items.filter((it) => it.side_name);
const sideDishSet = (it, priority) =>
  `menu_item:s${it.number} SET name = ${q(it.side_name)}, number = ${q(`S${it.number}`)}, price = 0f, ` +
  `cost = 0f, priority = ${priority}, source = 'manual', deleted_at = NONE, categories = [${SIDES_CATEGORY}]`;

/** Sides only, on a live menu: creates the side dishes and points the side choices at them. */
function buildSidesSql(data) {
  const lines = ['BEGIN TRANSACTION;'];
  const ci = data.categories.findIndex((c) => c.key === 'accompagnements');
  lines.push(`UPSERT ${categorySet(data.categories[ci], ci)};`);
  const notes = [];
  sideItems(data).forEach((it, i) => {
    lines.push(`UPSERT ${sideDishSet(it, 9000 + i)};`);
    lines.push(`UPDATE modifier:side_${it.number} SET modifier = menu_item:s${it.number};`);
    notes.push(`${it.name} → ${it.side_name}`);
  });
  lines.push('COMMIT TRANSACTION;');
  return { sql: lines.join('\n'), dishCount: notes.length, notes };
}

/** Outlets beyond Bar and Restaurant (the outlets migration creates those two). */
const outletsSql = (data) =>
  (data.outlets ?? []).map(
    (o) => `INSERT IGNORE INTO outlet { id: outlet:${o.key}, name: ${q(o.name)}, priority: ${Number(o.priority ?? 0)} };`,
  );

/** A category's own taxes ([] = untaxed, like the beach passes in ASI), else the menu's. */
const taxesOf = (data, c) => (Array.isArray(c.taxes) ? c.taxes : data.taxes);

/** The menu line of a dish: taxed with its category's taxes. */
const menuItemSet = (n, d) =>
  `menu_menu_item:m${n} SET menu_item = ${d.id}, active = true, tax_mode = 'exclusive', ` +
  `taxes = [${d.taxes.join(', ')}], tax = ${d.taxes[0] ?? 'NONE'}`;

/** @returns {Map<string, { id: string, item: any, cats: string[], outlet: string, taxes: string[] }>} */
function collectDishes(data) {
  const dishes = new Map();
  for (const c of data.categories) {
    for (const it of c.items) {
      if (it.ref) continue;
      dishes.set(`${c.key}::${it.name}`, {
        id: `menu_item:m${it.number}`, item: it, cats: [c.key], outlet: c.outlet, taxes: taxesOf(data, c),
      });
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

/** Variants as stored on the dish: name and price only (`from` is the JSON's bookkeeping). */
const variantsOf = (variants) =>
  `[${variants.map((v) => `{ name: ${q(v.name)}, price: ${Number(v.price).toFixed(2)}f }`).join(', ')}]`;

/** How the dish is sold: variants, by measure, or nothing for a single price. */
const sellingSet = (item) => {
  if (item.variants) return `, variants = ${variantsOf(item.variants)}`;
  if (item.measure_unit) {
    return `, measure_unit = ${q(item.measure_unit)}, measure_step = ${Number(item.measure_step ?? 0.5)}f`;
  }
  return '';
};

/**
 * Variants only, on a live menu: each bar dish with variants takes the formats it replaces
 * (their live prices) and those dishes leave the menu, soft-deleted so past orders keep them.
 * "Par oz" dishes are renamed and sold by measure. A dish that already has variants is skipped.
 */
async function buildVariantsSql(data) {
  const dishes = [...collectDishes(data).values()].filter((d) => d.item.variants || d.item.measure_unit);
  const numbers = new Set();
  for (const d of dishes) {
    numbers.add(d.item.number);
    (d.item.variants ?? []).forEach((v) => numbers.add(v.from));
  }
  const [rows] = await sql(
    `SELECT id, name, price, variants, deleted_at FROM ${[...numbers].map((n) => `menu_item:m${n}`).join(', ')};`,
  ).then((r) => r.map((x) => x.result));
  const live = new Map((rows ?? []).filter(Boolean).map((r) => [String(r.id).replace(/^menu_item:m/, ''), r]));

  const lines = ['BEGIN TRANSACTION;'];
  const notes = [];
  for (const d of dishes) {
    const n = d.item.number;
    const kept = live.get(n);
    if (!kept) {
      notes.push(`absent : menu_item:m${n} (${d.item.name})`);
      continue;
    }
    if (d.item.measure_unit) {
      lines.push(`UPDATE ${d.id} SET name = ${q(d.item.name)}${sellingSet(d.item)};`);
      continue;
    }
    if (Array.isArray(kept.variants) && kept.variants.length > 0) {
      notes.push(`déjà fait : ${d.item.name}`);
      continue;
    }
    const missing = d.item.variants.filter((v) => !live.has(v.from));
    if (missing.length > 0) {
      notes.push(`ignoré : ${d.item.name}, plats absents ${missing.map((v) => v.from).join(', ')}`);
      continue;
    }
    const variants = d.item.variants.map((v) => ({ name: v.name, price: Number(live.get(v.from).price) }));
    const price = Math.min(...variants.map((v) => v.price));
    lines.push(
      `UPDATE ${d.id} SET name = ${q(d.item.name)}, price = ${price.toFixed(2)}f, variants = ${variantsOf(variants)};`,
    );
    for (const v of d.item.variants) {
      if (v.from === n) continue;
      lines.push(`UPDATE menu_item:m${v.from} SET deleted_at = time::now();`);
      lines.push(`UPDATE menu_menu_item:m${v.from} SET active = false;`);
      lines.push(`UPDATE ${MENU_ID} SET items -= menu_menu_item:m${v.from};`);
      lines.push(`UPDATE kitchen SET items -= menu_item:m${v.from} WHERE items CONTAINS menu_item:m${v.from};`);
    }
    notes.push(`${d.item.name} : ${variants.map((v) => `${v.name} ${v.price}`).join(' / ')}`);
  }
  lines.push('COMMIT TRANSACTION;');
  return { sql: lines.join('\n'), dishCount: dishes.length, notes };
}

/** Outlets that have stations: a new dish there joins them. Others (Plage) skip the kitchen. */
const KITCHEN_OUTLETS = ['restaurant', 'bar'];

/**
 * Add only, on a live menu: outlets, categories and dishes of the JSON that the database
 * lacks are created and put on the menu. Nothing existing is changed; orders stay.
 */
async function buildAddSql(data) {
  const [catRows, dishRows, maxRows] = await sql(
    'SELECT VALUE id FROM category; SELECT VALUE id FROM menu_item; ' +
      'SELECT VALUE priority FROM menu_item ORDER BY priority DESC LIMIT 1;',
  ).then((r) => r.map((x) => x.result));
  const cats = new Set((catRows ?? []).map(String));
  const existing = new Set((dishRows ?? []).map(String));
  let pos = Number(maxRows?.[0] ?? 0);

  const lines = ['BEGIN TRANSACTION;', ...outletsSql(data)];
  const notes = [];
  data.categories.forEach((c, ci) => {
    if (cats.has(`category:${c.key}`)) return;
    lines.push(`CREATE ${categorySet(c, ci)};`);
    notes.push(`catégorie ${c.name} (${c.outlet})`);
  });
  const dishes = [...collectDishes(data).values()].filter((d) => !existing.has(d.id));
  for (const d of dishes) {
    pos += 1;
    const n = d.item.number;
    lines.push(
      `CREATE ${d.id} SET name = ${q(d.item.name)}, number = ${q(n)}, price = ${d.item.price.toFixed(2)}f, ` +
        `cost = 0f, priority = ${pos}, source = 'manual', deleted_at = NONE, ` +
        `categories = [${d.cats.map((k) => `category:${k}`).join(', ')}]` +
        (descriptionOf(d.item) ? `, description = ${descriptionOf(d.item)}` : '') +
        sellingSet(d.item) + ';',
    );
    lines.push(`CREATE ${menuItemSet(n, d)};`);
    lines.push(`UPDATE ${MENU_ID} SET items += menu_menu_item:m${n};`);
    if (KITCHEN_OUTLETS.includes(d.outlet)) {
      lines.push(`UPDATE kitchen SET items += ${d.id} WHERE outlet = outlet:${d.outlet} AND deleted_at = NONE;`);
    }
    notes.push(`plat ${d.item.name} ${d.item.price} (${d.taxes.length ? 'taxé' : 'sans taxe'})`);
  }
  lines.push('COMMIT TRANSACTION;');
  return { sql: lines.join('\n'), dishCount: dishes.length, notes };
}

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
  lines.push(...outletsSql(data));

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
        (descriptionOf(d.item) ? `, description = ${descriptionOf(d.item)}` : '') +
        sellingSet(d.item) + ';',
    );
    lines.push(`CREATE ${menuItemSet(n, d)};`);
    menuItems.push(`menu_menu_item:m${n}`);
    // Outlets without a station (Plage) never reach a KDS or a kitchen printer.
    byOutlet[d.outlet]?.push(d.id);
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
  const modIds = sideItems(data).map((it, i) => {
    lines.push(`CREATE ${sideDishSet(it, 9000 + i)};`);
    lines.push(`CREATE modifier:side_${it.number} SET modifier = menu_item:s${it.number}, price = 0f;`);
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
  const { sql: script, dishCount, notes } = SIDES_ONLY
    ? buildSidesSql(data)
    : ADD_ONLY
    ? await buildAddSql(data)
    : VARIANTS_ONLY
      ? await buildVariantsSql(data)
      : CATEGORIES_ONLY ? buildCategoriesSql(data) : buildSql(data);
  (notes ?? []).forEach((note) => console.error(`-- ${note}`));

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
