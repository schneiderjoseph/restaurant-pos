'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require('mssql');

(async () => {
  const p = await sql.connect({
    server: process.env.ASI_FD_SQL_SERVER || process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_FD_SQL_PORT || process.env.ASI_SQL_PORT),
    database: process.env.ASI_FD_SQL_DATABASE || 'ASIFD600',
    user: process.env.ASI_FD_SQL_USER,
    password: process.env.ASI_FD_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const cols = await p.request().query('SELECT TOP 1 * FROM cUnit');
  console.log('cols', Object.keys(cols.recordset[0] || {}));

  const n = await p.request().query(
    'SELECT COUNT(*) AS n FROM cUnit WHERE ISNULL(isDeleted,0)=0 AND ISNULL(isActive,1)=1',
  );
  console.log('active', n.recordset[0].n);

  const r = await p.request().query(`
    SELECT
      u.unitID, u.unitAlias, u.unitName, u.floorID, u.unitTypeID,
      u.isActive, u.isDeleted, u.baseAdult, u.orderID,
      f.floorName, t.unitTypeName
    FROM cUnit u
    LEFT JOIN cFloor f ON f.floorID = u.floorID
    LEFT JOIN cUnitType t ON t.unitTypeID = u.unitTypeID
    WHERE ISNULL(u.isDeleted, 0) = 0
      AND ISNULL(u.isActive, 1) = 1
    ORDER BY TRY_CAST(u.unitAlias AS INT), u.unitAlias
  `);

  for (const x of r.recordset) {
    console.log(
      [
        x.unitID,
        x.unitAlias,
        x.unitName,
        x.floorName || '-',
        x.unitTypeName || '-',
        'adults=' + (x.baseAdult ?? '-'),
        'ord=' + (x.orderID ?? '-'),
      ].join('\t'),
    );
  }
  console.log('total', r.recordset.length);
  await p.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
