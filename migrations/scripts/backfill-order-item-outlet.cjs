'use strict';

/**
 * Copy the point of sale (outlet) onto order lines sold before outlets existed, so the
 * sales-by-outlet report covers past days too. Same rule as src/lib/outlet.ts resolveOutlet:
 * the outlet of the category the line was picked from (inherited through `parent`), else
 * the dish's categories when they all agree; otherwise the line stays unclassified.
 *
 * Run it AFTER the categories have been given their outlet in the admin — before that every
 * line resolves to nothing. Lines that already carry an outlet are never touched.
 *
 * Usage:
 *   SURREAL_USER=... SURREAL_PASS=... node migrations/scripts/backfill-order-item-outlet.cjs
 *
 * Env:
 *   DRY_RUN=1 — count only, do not write
 */

const WS = require('ws');
const { Surreal, StringRecordId } = require('surrealdb');
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
const DRY_RUN = process.env.DRY_RUN === '1';

const rows = (result) => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? first : [];
};

const toId = (value) => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.toString === 'function') {
    const asString = value.toString();
    if (asString && asString !== '[object Object]' && asString.includes(':')) {
      return asString;
    }
  }
  if (typeof value === 'object' && value.tb != null && value.id != null) {
    return `${value.tb}:${value.id}`;
  }
  return String(value);
};

function outletOfCategory(categoryId, categories) {
  const visited = new Set();
  let id = toId(categoryId);
  while (id && !visited.has(id)) {
    visited.add(id);
    const category = categories.get(id);
    if (!category) return null;
    if (category.outlet && category.outlet.name) return category.outlet;
    id = toId(category.parent);
  }
  return null;
}

function resolveOutlet(line, categories) {
  const picked = outletOfCategory(line.category_id, categories);
  if (picked) return picked;

  const candidates = new Map();
  for (const categoryId of line.dish_categories || []) {
    const outlet = outletOfCategory(categoryId, categories);
    if (!outlet) return null;
    candidates.set(toId(outlet.id), outlet);
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

async function main() {
  const db = new Surreal();
  await db.connect(DB_URL);
  await db.signin({ username: DB_USER, password: DB_PASS });
  await db.use({ namespace: DB_NS, database: DB_NAME });

  console.log(`Connected ${DB_URL} ${DB_NS}/${DB_NAME} DRY_RUN=${DRY_RUN}`);

  const categories = new Map(
    rows(await db.query('SELECT id, parent, outlet FROM category FETCH outlet'))
      .map((category) => [toId(category.id), category]),
  );
  const lines = rows(await db.query(
    'SELECT id, category_id, item.categories AS dish_categories FROM order_item WHERE outlet_id = NONE OR outlet_id = NULL',
  ));

  const stats = { updated: 0, unclassified: 0 };
  for (const line of lines) {
    const outlet = resolveOutlet(line, categories);
    if (!outlet) {
      stats.unclassified += 1;
      continue;
    }
    stats.updated += 1;
    if (!DRY_RUN) {
      await db.query('UPDATE $id SET outlet_id = $outlet_id, outlet = $outlet', {
        id: new StringRecordId(toId(line.id)),
        outlet_id: new StringRecordId(toId(outlet.id)),
        outlet: outlet.name,
      });
    }
  }

  console.log(JSON.stringify(stats, null, 2));
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
