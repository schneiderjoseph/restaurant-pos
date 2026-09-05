'use strict';

const sql = require('mssql');

/**
 * Dining tables from ASIPOS600 mTable (+ optional tTablePOS layout).
 * Example property: TB1–TB10 (salle) + B1–B16 (bar); layout mostly empty.
 */

function shortLabel(tableName, alias) {
  const name = String(tableName || '').trim();
  const named = name.match(/^(.+?)\s+(\d+)\s*$/);
  if (named) {
    const head = named[1].trim().toUpperCase();
    const num = named[2];
    if (head === 'TABLE' || head === 'T') return { name: 'T', number: num };
    if (head === 'BAR' || head === 'B') return { name: 'B', number: num };
    return { name: head.slice(0, 3), number: num };
  }

  const a = String(alias || '').trim();
  const aliased = a.match(/^(TB|B|T)(\d+)$/i);
  if (aliased) {
    const prefix = aliased[1].toUpperCase() === 'TB' ? 'T' : aliased[1].toUpperCase();
    return { name: prefix, number: aliased[2] };
  }

  return {
    name: a ? a.replace(/\d+$/, '') || 'T' : 'T',
    number: a.replace(/^\D+/, '') || a || '0',
  };
}

function mapTable(row) {
  const alias = String(row.tableAlias || '').trim();
  const tableName = String(row.tableName || '').trim();
  const { name, number } = shortLabel(tableName, alias);
  const left = row.leftPosition != null ? Number(row.leftPosition) : null;
  const top = row.topPosition != null ? Number(row.topPosition) : null;
  const width = row.tableWidth != null ? Number(row.tableWidth) : null;
  const height = row.tableHeight != null ? Number(row.tableHeight) : null;
  const capacity = row.maxOccupancy != null ? Number(row.maxOccupancy) : null;

  return {
    asiTableId: Number(row.tableID),
    alias,
    tableName: tableName || alias || `ASI Table ${row.tableID}`,
    name,
    number,
    isActive: row.isActive === true || row.isActive === 1,
    isDeleted: row.isDeleted === true || row.isDeleted === 1,
    posId: row.POSId != null ? Number(row.POSId) : null,
    tablePosId: row.tablePOSId != null ? Number(row.tablePOSId) : null,
    left: Number.isFinite(left) ? left : null,
    top: Number.isFinite(top) ? top : null,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    capacity: Number.isFinite(capacity) && capacity > 0 ? Math.round(capacity) : null,
  };
}

async function fetchAsiTables(asiConfig) {
  const pool = await sql.connect({
    server: asiConfig.server,
    port: asiConfig.port,
    database: asiConfig.database,
    user: asiConfig.user,
    password: asiConfig.password,
    options: {
      encrypt: !!asiConfig.encrypt,
      trustServerCertificate: asiConfig.trustCert !== false,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  });

  try {
    let q = `
      SELECT
        t.tableID, t.tableAlias, t.tableName, t.isActive, t.isDeleted,
        tp.tablePOSId, tp.POSId, tp.topPosition, tp.leftPosition,
        tp.maxOccupancy, tp.tableWidth, tp.tableHeight, tp.isActive AS posActive
      FROM mTable t
      LEFT JOIN tTablePOS tp ON tp.tableId = t.tableID
      WHERE ISNULL(t.isDeleted, 0) = 0
    `;
    if (asiConfig.posId != null && Number.isFinite(asiConfig.posId)) {
      // Prefer outlet-specific layout rows when present; keep master if no POS row.
      q += ` AND (tp.tablePOSId IS NULL OR tp.POSId = ${Number(asiConfig.posId)})`;
    }
    q += ` ORDER BY t.tableID`;

    const result = await pool.request().query(q);
    /** @type {Map<number, object>} */
    const byId = new Map();
    for (const row of result.recordset || []) {
      const mapped = mapTable(row);
      const prev = byId.get(mapped.asiTableId);
      // Prefer the row that has layout coordinates when duplicates appear.
      if (
        !prev ||
        ((mapped.left != null || mapped.top != null) &&
          prev.left == null &&
          prev.top == null)
      ) {
        byId.set(mapped.asiTableId, mapped);
      }
    }

    const tables = [...byId.values()].filter((t) => t.isActive && !t.isDeleted);
    return { tables };
  } finally {
    await pool.close().catch(() => {});
  }
}

module.exports = { fetchAsiTables, mapTable, shortLabel };
