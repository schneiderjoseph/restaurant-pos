'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require('mssql');

(async () => {
  const p = await sql.connect({
    server: process.env.ASI_FD_SQL_SERVER || process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_FD_SQL_PORT || process.env.ASI_SQL_PORT),
    database: process.env.ASI_FD_SQL_DATABASE || 'ASIFD600',
    user: process.env.ASI_FD_SQL_USER || process.env.ASI_SQL_USER,
    password: process.env.ASI_FD_SQL_PASSWORD || process.env.ASI_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  for (const name of ['cUnit', 'cFloor', 'cBuilding', 'cRoomType', 'mRoom', 'fUnit']) {
    try {
      const cols = await p.request().query(`SELECT TOP 1 * FROM [${name}]`);
      console.log(`\n=== ${name} cols ===`, Object.keys(cols.recordset[0] || {}));
      const n = await p.request().query(`SELECT COUNT(*) AS n FROM [${name}]`);
      console.log('count', n.recordset[0].n);
      const s = await p.request().query(`SELECT TOP 12 * FROM [${name}]`);
      console.log(JSON.stringify(s.recordset, null, 2).slice(0, 2000));
    } catch (e) {
      console.log(`${name}: ${String(e.message).split('\n')[0]}`);
    }
  }

  // List unit-related tables
  const tables = await p.request().query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE'
      AND (TABLE_NAME LIKE '%Unit%' OR TABLE_NAME LIKE '%Room%' OR TABLE_NAME LIKE '%Floor%' OR TABLE_NAME LIKE '%Building%')
    ORDER BY TABLE_NAME
  `);
  console.log('\n--- matching tables ---');
  console.log(tables.recordset.map((r) => r.TABLE_NAME).join('\n'));

  await p.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
