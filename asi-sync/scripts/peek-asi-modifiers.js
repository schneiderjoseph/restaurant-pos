'use strict';

/**
 * Read-only look at how ASI stores modifiers / side dishes (accompagnements), so the sync can
 * map them to POSR modifier groups. Prints table names, columns, counts and sample rows with the
 * item names resolved. Writes nothing.
 *
 *   cd asi-sync
 *   node scripts/peek-asi-modifiers.js > modifiers.txt
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require('mssql');

const SAMPLE = 40;

const print = (label, value) => console.log(`\n=== ${label}\n${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}`);

(async () => {
  const pool = await sql.connect({
    server: process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_SQL_PORT),
    database: process.env.ASI_SQL_DATABASE,
    user: process.env.ASI_SQL_USER,
    password: process.env.ASI_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const query = async (text) => (await pool.request().query(text)).recordset;

  // 1. Every table whose name hints at modifiers, sides, combos or options.
  const tables = await query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE' AND (
      TABLE_NAME LIKE '%odif%' OR TABLE_NAME LIKE '%ccomp%' OR TABLE_NAME LIKE '%ombo%'
      OR TABLE_NAME LIKE '%ption%' OR TABLE_NAME LIKE '%hoice%' OR TABLE_NAME LIKE '%ondiment%'
      OR TABLE_NAME LIKE '%ddon%' OR TABLE_NAME LIKE '%Kit%' OR TABLE_NAME LIKE '%Link%'
      OR TABLE_NAME LIKE '%Set%' OR TABLE_NAME LIKE '%Package%' OR TABLE_NAME LIKE '%Menu%'
    )
    ORDER BY TABLE_NAME
  `);
  print('candidate tables', tables.map((t) => t.TABLE_NAME));

  const itemNames = new Map(
    (await query('SELECT itemID, itemAlias, itemName FROM mItem')).map((r) => [
      Number(r.itemID),
      `${String(r.itemAlias || '').trim()} ${String(r.itemName || '').trim()}`.trim(),
    ]),
  );
  const itemGroupOf = new Map(
    (await query(`
      SELECT p.itemID, p.itemPosID, g.itemgroupAlias
      FROM tItemPOS p INNER JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
    `)).flatMap((r) => [
      [`item:${r.itemID}`, String(r.itemgroupAlias || '').trim()],
      [`pos:${r.itemPosID}`, `${String(r.itemgroupAlias || '').trim()} (itemID ${r.itemID})`],
    ]),
  );

  // 2. For each candidate: columns, row count, sample rows with item ids resolved to names.
  for (const { TABLE_NAME: table } of tables) {
    try {
      const columns = await query(`
        SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${table}' ORDER BY ORDINAL_POSITION
      `);
      const [{ n }] = await query(`SELECT COUNT(*) AS n FROM [${table}]`);
      print(`${table} — ${n} rows — columns`, columns.map((c) => `${c.COLUMN_NAME} ${c.DATA_TYPE}`).join('\n'));
      if (n === 0) continue;

      const rows = await query(`SELECT TOP ${SAMPLE} * FROM [${table}]`);
      const lines = rows.map((row) =>
        Object.entries(row)
          .map(([key, value]) => {
            const k = key.toLowerCase();
            const id = Number(value);
            if (Number.isFinite(id) && k.includes('pos') && k.endsWith('id') && itemGroupOf.has(`pos:${id}`)) {
              return `${key}=${value} [${itemGroupOf.get(`pos:${id}`)}]`;
            }
            if (Number.isFinite(id) && k.endsWith('id') && (k.includes('item') || k.includes('modif')) && itemNames.has(id)) {
              return `${key}=${value} [${itemNames.get(id)} / ${itemGroupOf.get(`item:${id}`) ?? '-'}]`;
            }
            return `${key}=${value instanceof Date ? value.toISOString() : value}`;
          })
          .join(' | '),
      );
      print(`${table} — first ${rows.length} rows`, lines.join('\n'));
    } catch (error) {
      print(`${table} — not readable`, error.message);
    }
  }

  // 3. The side-dish groups as they are sold today (ACCOM / ADD / TOPPZ).
  const sides = await query(`
    SELECT g.itemgroupAlias, i.itemID, i.itemAlias, i.itemName, i.sales, i.isActive
    FROM mItem i
    INNER JOIN tItemPOS p ON p.itemID = i.itemID
    INNER JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
    WHERE g.itemgroupAlias IN ('ACCOM', 'ADD', 'TOPPZ') AND i.isDeleted = 0
    ORDER BY g.itemgroupAlias, i.itemName
  `);
  print('items in ACCOM / ADD / TOPPZ', sides.map((r) =>
    `${r.itemgroupAlias} ${r.itemID} ${String(r.itemAlias || '').trim()} ${String(r.itemName || '').trim()} sales=${!!r.sales} active=${!!r.isActive}`,
  ).join('\n'));

  await pool.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
