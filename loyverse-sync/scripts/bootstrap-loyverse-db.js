'use strict';

/**
 * Bootstrap an isolated Surreal NS/DB for Loyverse (does not touch posr/posr).
 *
 * Default target: ws://127.0.0.1:8001/rpc → namespace loyverse / database loyverse
 *
 * Usage (repo root):
 *   node loyverse-sync/scripts/bootstrap-loyverse-db.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const WS = require('ws');
const { Surreal } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') global.WebSocket = WS;

const url = process.env.SURREAL_URL || 'ws://127.0.0.1:8001/rpc';
// Force isolated defaults — ignore inherited shell SURREAL_NS=posr unless LOYVERSE_* set.
const ns = process.env.LOYVERSE_SURREAL_NS || 'loyverse';
const dbName = process.env.LOYVERSE_SURREAL_DB || 'loyverse';
const user = process.env.SURREAL_USER || 'posr';
const pass = process.env.SURREAL_PASS || 'posr-local-dev-change-me';

if (ns === 'posr' && dbName === 'posr') {
  console.error('Refusing to bootstrap into posr/posr. Use LOYVERSE_SURREAL_NS/DB=loyverse.');
  process.exit(1);
}

const root = path.join(__dirname, '..', '..');

const stripComments = (sql) =>
  sql
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('--')) return '';
      return line;
    })
    .join('\n');

async function runFile(db, relPath) {
  const filePath = path.join(root, relPath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const sql = stripComments(raw).trim();
  console.log(`Applying ${relPath} …`);
  await db.query(sql);
  console.log(`  done ${relPath}`);
}

async function tryQuery(db, sql, label) {
  try {
    await db.query(sql);
  } catch (err) {
    const msg = String(err?.message || err);
    if (/already exists|already defined/i.test(msg)) {
      console.log(`  skip ${label} (exists)`);
      return;
    }
    throw err;
  }
}

async function main() {
  console.log(`Bootstrapping ${url} → ${ns}/${dbName}`);
  const db = new Surreal();
  await db.connect(url, {
    authentication: { username: user, password: pass },
  });

  await db.query(`DEFINE NAMESPACE IF NOT EXISTS \`${ns}\``);
  await db.use({ namespace: ns, database: 'main' }).catch(async () => {
    await db.query(`DEFINE DATABASE IF NOT EXISTS main`);
    await db.use({ namespace: ns, database: 'main' });
  });
  try {
    await db.query(`DEFINE DATABASE IF NOT EXISTS \`${dbName}\``);
  } catch (err) {
    console.warn('DEFINE DATABASE note:', err.message);
  }
  await db.use({ namespace: ns, database: dbName });

  await runFile(db, 'migrations/latest.surql');
  await runFile(db, 'migrations/2026_08_26_loyverse_sync_fields.surql');
  await runFile(db, 'migrations/2026_08_27_loyverse_mirror.surql');

  console.log('Applying Loyverse extra fields (idempotent) …');
  const extras = [
    [`DEFINE FIELD source ON customer TYPE none | string | null PERMISSIONS FULL`, 'customer.source'],
    [`DEFINE FIELD loyverse_id ON customer TYPE none | string | null PERMISSIONS FULL`, 'customer.loyverse_id'],
    [`DEFINE FIELD guest_code ON customer TYPE none | string | null PERMISSIONS FULL`, 'customer.guest_code'],
    [`DEFINE INDEX customer_loyverse_id ON customer FIELDS loyverse_id`, 'idx customer'],
    [`DEFINE FIELD source ON payment_type TYPE none | string | null PERMISSIONS FULL`, 'payment_type.source'],
    [`DEFINE FIELD loyverse_id ON payment_type TYPE none | string | null PERMISSIONS FULL`, 'payment_type.loyverse_id'],
    [`DEFINE INDEX payment_type_loyverse_id ON payment_type FIELDS loyverse_id`, 'idx payment'],
    [`DEFINE FIELD source ON discount TYPE none | string | null PERMISSIONS FULL`, 'discount.source'],
    [`DEFINE FIELD loyverse_id ON discount TYPE none | string | null PERMISSIONS FULL`, 'discount.loyverse_id'],
    [`DEFINE INDEX discount_loyverse_id ON discount FIELDS loyverse_id`, 'idx discount'],
  ];
  for (const [sql, label] of extras) {
    await tryQuery(db, sql, label);
  }

  console.log('Patching mirror schema (flexible JSON) …');
  await tryQuery(
    db,
    'DEFINE FIELD OVERWRITE payload ON loyverse_mirror TYPE any PERMISSIONS FULL',
    'mirror.payload any',
  );
  await tryQuery(
    db,
    'DEFINE FIELD OVERWRITE stats ON loyverse_sync_state TYPE any DEFAULT {} PERMISSIONS FULL',
    'sync_state.stats any',
  );

  console.log(`Ready: ${ns}/${dbName}`);
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
