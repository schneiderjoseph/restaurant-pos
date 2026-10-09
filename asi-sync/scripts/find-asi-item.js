'use strict';

/**
 * Looks up items in ASI by name, read-only: prices per point of sale and group.
 *
 *   node asi-sync/scripts/find-asi-item.js "pina colada"
 *   node asi-sync/scripts/find-asi-item.js kibby benedicta
 *
 * ASI tables: mItem (items), tItemPOS (an item on a point of sale, with its group),
 * mItemGroup (groups: RHUM, COCKTAILS…), mItemRate (price `rate1`, taxes) and mPOS
 * (points of sale: 1 BARRESTO, 2 BAR, 3 Restaurant, 4 Cuisine). Connection from asi-sync/.env.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require('mssql');

const terms = process.argv.slice(2).map((t) => t.trim()).filter(Boolean);
if (terms.length === 0) {
  console.error('Usage: node asi-sync/scripts/find-asi-item.js "nom" [autre nom…]');
  process.exit(1);
}

(async () => {
  const pool = await sql.connect({
    server: process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_SQL_PORT),
    database: process.env.ASI_SQL_DATABASE,
    user: process.env.ASI_SQL_USER,
    password: process.env.ASI_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    for (const term of terms) {
      const request = pool.request().input('term', sql.NVarChar, `%${term}%`);
      const { recordset } = await request.query(`
        SELECT i.itemID, i.itemName, i.isActive, g.itemgroupName, pos.posName, r.rate1, r.tax1On, r.tax2On
        FROM mItem i
        LEFT JOIN tItemPOS p ON p.itemID = i.itemID
        LEFT JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
        LEFT JOIN mPOS pos ON pos.posID = p.posID
        LEFT JOIN mItemRate r ON r.itemPOSId = p.itemPosID
        WHERE i.isDeleted = 0 AND i.itemName LIKE @term
        ORDER BY i.itemName, pos.posName`);
      console.log(`\n== "${term}" : ${recordset.length} ligne(s)`);
      for (const row of recordset) {
        const taxes = [row.tax1On && 'TCA', row.tax2On && 'SERVICE'].filter(Boolean).join('+') || 'sans taxe';
        console.log(
          `#${row.itemID}  ${row.itemName}  |  ${row.itemgroupName ?? '-'}  |  ${row.posName ?? '-'}  |  ` +
            `${row.rate1 ?? '-'}  |  ${taxes}${row.isActive ? '' : '  (inactif)'}`,
        );
      }
    }
  } finally {
    await pool.close();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
