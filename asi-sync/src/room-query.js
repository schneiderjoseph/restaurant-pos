'use strict';

const sql = require('mssql');

/**
 * Hotel rooms from ASI FrontDesk ASIFD600 (cUnit + cFloor + cUnitType).
 * La Réserve: ~21 active units on ETAGE1 (aliases 14–35).
 */

function mapRoom(row) {
  const alias = String(row.unitAlias || '').trim();
  const unitName = String(row.unitName || '').trim();
  const floorName = String(row.floorName || '').trim();
  const unitType = String(row.unitTypeName || '').trim();
  const baseAdult = row.baseAdult != null ? Number(row.baseAdult) : null;
  const orderId = row.orderID != null ? Number(row.orderID) : null;

  return {
    asiUnitId: Number(row.unitID),
    alias,
    unitName: unitName || alias || `Room ${row.unitID}`,
    // Display like tables: name + number → R14, R21…
    name: 'R',
    number: alias || String(row.unitID),
    floorName: floorName || 'Chambres',
    unitType: unitType || null,
    capacity:
      Number.isFinite(baseAdult) && baseAdult > 0 ? Math.round(baseAdult) : null,
    sortOrder: Number.isFinite(orderId) ? orderId : Number(alias) || Number(row.unitID),
    isActive: row.isActive === true || row.isActive === 1,
    isDeleted: row.isDeleted === true || row.isDeleted === 1,
  };
}

async function fetchAsiRooms(fdConfig) {
  const pool = await sql.connect({
    server: fdConfig.server,
    port: fdConfig.port,
    database: fdConfig.database,
    user: fdConfig.user,
    password: fdConfig.password,
    options: {
      encrypt: !!fdConfig.encrypt,
      trustServerCertificate: fdConfig.trustCert !== false,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  });

  try {
    const result = await pool.request().query(`
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

    const rooms = (result.recordset || [])
      .map(mapRoom)
      .filter((r) => Number.isFinite(r.asiUnitId) && r.isActive && !r.isDeleted);

    return { rooms };
  } finally {
    await pool.close().catch(() => {});
  }
}

module.exports = { fetchAsiRooms, mapRoom };
