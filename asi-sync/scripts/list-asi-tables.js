'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require('mssql');

(async () => {
  const p = await sql.connect({
    server: process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_SQL_PORT),
    database: process.env.ASI_SQL_DATABASE,
    user: process.env.ASI_SQL_USER,
    password: process.env.ASI_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const cols = await p.request().query('SELECT TOP 1 * FROM mTable');
  console.log('mTable cols', Object.keys(cols.recordset[0] || {}));

  try {
    const c2 = await p.request().query('SELECT TOP 1 * FROM tTablePOS');
    console.log('tTablePOS cols', Object.keys(c2.recordset[0] || {}));
  } catch (e) {
    console.log('tTablePOS', e.message);
  }

  const r = await p.request().query(`
    SELECT t.tableID, t.tableAlias, t.tableName, t.isActive, t.isDeleted,
           tp.tablePOSId, tp.POSId, tp.topPosition, tp.leftPosition,
           tp.maxOccupancy, tp.tableWidth, tp.tableHeight, tp.isActive AS posActive
    FROM mTable t
    LEFT JOIN tTablePOS tp ON tp.tableId = t.tableID
    WHERE ISNULL(t.isDeleted, 0) = 0
    ORDER BY t.tableID
  `);

  for (const x of r.recordset) {
    console.log(
      String(x.tableID).padStart(3),
      String(x.tableAlias || '').padEnd(6),
      String(x.tableName || '').padEnd(16),
      'active=' + !!x.isActive,
      'pos=' + (x.tablePOSId ?? '-'),
      'xy=' + (x.tablePOSId != null ? `${x.leftPosition},${x.topPosition}` : '-'),
      'wh=' + `${x.tableWidth ?? '-'}x${x.tableHeight ?? '-'}`,
      'occ=' + (x.maxOccupancy ?? '-'),
    );
  }
  console.log('total', r.recordset.length);
  await p.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
