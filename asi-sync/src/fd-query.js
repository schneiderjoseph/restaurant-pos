'use strict';

const sql = require('mssql');

/**
 * In-house guests from ASI FrontDesk ASIFD600.
 * Room number comes from cUnit.unitAlias (e.g. "21").
 * Mapping validated on SERVERCORMIER (see docs/integrations/ASI-LA-RESERVE.md §9.2).
 */
async function fetchInHouseGuests(cfg) {
  const pool = await sql.connect({
    server: cfg.server,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    options: {
      encrypt: !!cfg.encrypt,
      trustServerCertificate: cfg.trustCert !== false,
      enableArithAbort: true,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  });

  try {
    const result = await pool.request().query(`
      SELECT
        ci.checkInID,
        ci.guestID,
        ci.folioNo,
        ci.unitID,
        LTRIM(RTRIM(ISNULL(ci.firstName, ''))) AS firstName,
        LTRIM(RTRIM(ISNULL(ci.middleName, ''))) AS middleName,
        LTRIM(RTRIM(ISNULL(ci.lastName, ''))) AS lastName,
        LTRIM(RTRIM(ISNULL(ci.mobileNumber, ''))) AS mobileNumber,
        LTRIM(RTRIM(ISNULL(ci.homePhoneNumber1, ''))) AS homePhone,
        LTRIM(RTRIM(ISNULL(ci.email1, ''))) AS email1,
        ci.dateIn,
        ci.dateOut,
        u.unitAlias,
        u.unitName
      FROM fCheckInInfo ci
      LEFT JOIN cUnit u ON u.unitID = ci.unitID
      WHERE ci.isCheckOut = 0
        AND ISNULL(ci.isAnonymized, 0) = 0
      ORDER BY ci.checkInID DESC
    `);

    const guests = (result.recordset || []).map((row) => {
      const first = String(row.firstName || '').trim();
      const middle = String(row.middleName || '').trim();
      const last = String(row.lastName || '').trim();
      const name = [first, middle, last].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      const room = String(row.unitAlias || row.unitName || '').trim();
      const phone = String(row.mobileNumber || row.homePhone || '').trim();
      const email = String(row.email1 || '').trim();
      const folio = String(row.folioNo || '').trim();
      const checkInId = Number(row.checkInID);
      return {
        checkInId,
        guestId: Number(row.guestID) || null,
        folioNo: folio || null,
        unitId: row.unitID != null ? Number(row.unitID) : null,
        name: name || (folio ? `Folio ${folio}` : `Guest ${checkInId}`),
        room: room || null,
        phone: phone || null,
        email: email || null,
        guestCode: `FD-${checkInId}`,
        dateIn: row.dateIn || null,
        dateOut: row.dateOut || null,
      };
    });

    return { guests };
  } finally {
    await pool.close().catch(() => {});
  }
}

module.exports = { fetchInHouseGuests };
