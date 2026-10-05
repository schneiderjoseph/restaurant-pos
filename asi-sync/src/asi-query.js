'use strict';

/**
 * ASI catalog pull for POSR.
 *
 * Photos: mItem has no per-item image column today (mItemGroup.itemgroupImage is
 * empty). When ASI exposes item photos, sync them into POSR `document` +
 * `dish.dish_photo`. POS setting `menuConfig.showDishPhotos` (off by default)
 * will then show them on menu tiles.
 */

const sql = require('mssql');
const { stationForGroup } = require('./stations');

/**
 * Pick selling price from ASI rate row (USD base — confirm currency per property).
 * defaultRate is 1..5 → rate1..rate5; fall back to rate1.
 *
 * Photos: ASI mItem currently has no per-item image column (only empty
 * mItemGroup.itemgroupImage). When ASI exposes item photos, sync them into
 * POSR documents + dish.dish_photo; the POS toggle showDishPhotos will then
 * display them on menu tiles.
 */
function resolvePriceUsd(row) {
  const idx = Number(row.defaultRate);
  const n = Number.isFinite(idx) && idx >= 1 && idx <= 5 ? idx : 1;
  const key = `rate${n}`;
  const raw = row[key] != null ? row[key] : row.rate1;
  const price = Number(raw);
  return Number.isFinite(price) ? price : 0;
}

/**
 * ASI tax captions from mParameter (posTax1=TCA, posTax2=Services Charges, …).
 * @returns {Promise<Record<number, string>>}
 */
async function fetchTaxCaptions(pool) {
  const result = await pool.request().query(`
    SELECT keyName, keyValue
    FROM mParameter
    WHERE keyName IN ('posTax1', 'posTax2', 'posTax3', 'posTax4', 'posTax5')
  `);
  /** @type {Record<number, string>} */
  const captions = {};
  for (const row of result.recordset || []) {
    const m = /^posTax([1-5])$/.exec(String(row.keyName || ''));
    if (!m) continue;
    const slot = Number(m[1]);
    const label = String(row.keyValue || '').trim();
    captions[slot] = label || `Tax ${slot}`;
  }
  return captions;
}

/**
 * ASI tax slots with rate > 0. taxNOn is compound-on-previous in ASI; rates still apply when > 0.
 * @param {object} row
 * @param {Record<number, string>} [captions]
 */
function resolveTaxes(row, captions = {}) {
  const taxes = [];
  for (let i = 1; i <= 5; i += 1) {
    const rate = Number(row[`tax${i}`]);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    // Ignore obvious data-entry outliers (e.g. 500)
    if (rate > 100) continue;
    taxes.push({
      slot: i,
      rate,
      compound: row[`tax${i}On`] === true || row[`tax${i}On`] === 1,
      label: captions[i] || `Tax ${i}`,
    });
  }
  return taxes;
}

/**
 * @param {object} row
 * @param {number[]} [posIds] selected outlets in priority order (first wins)
 */
function scoreRateRow(row, posIds = []) {
  let score = 0;
  if (row.isDefaultUnit === true || row.isDefaultUnit === 1) score += 100;
  const price = resolvePriceUsd(row);
  if (price > 0) score += 20;
  // Outlet priority outranks everything else, but only for a priced row: an
  // item left at 0 in the first outlet still takes its price from the next one.
  const rank = posIds.indexOf(Number(row.posID));
  if (rank >= 0 && price > 0) score += (posIds.length - rank) * 1000;
  // Prefer the defaultRate slot when set.
  if (row.defaultRate != null) score += 2;
  // Tie-break: higher selling price (avoids 0-rate outlet rows winning).
  score += Math.min(price, 1_000_000) / 1_000_000;
  return score;
}

/** Collapse join duplicates to one record per itemID (best rate / default unit). */
function dedupeItems(rows, posIds = []) {
  /** @type {Map<number, object>} */
  const map = new Map();
  for (const row of rows) {
    const id = Number(row.itemID);
    if (!Number.isFinite(id)) continue;
    const prev = map.get(id);
    if (!prev || scoreRateRow(row, posIds) > scoreRateRow(prev, posIds)) {
      map.set(id, row);
    }
  }
  return [...map.values()];
}

function mapGroup(row) {
  return {
    asiGroupId: Number(row.itemgroupID),
    alias: String(row.itemgroupAlias || '').trim(),
    name: String(row.itemgroupName || '').trim() || `ASI Group ${row.itemgroupID}`,
    isActive: row.isActive === true || row.isActive === 1,
    isDeleted: row.isDeleted === true || row.isDeleted === 1,
  };
}

function mapItem(row, fxHtg, captions = {}) {
  const alias = String(row.itemgroupAlias || '').trim();
  const groupName = String(row.itemgroupName || '').trim();
  const itemAlias = String(row.itemAlias || '').trim();
  const priceUsd = resolvePriceUsd(row);
  const price =
    fxHtg != null && Number.isFinite(fxHtg) && fxHtg > 0
      ? Math.round(priceUsd * fxHtg * 100) / 100
      : priceUsd;

  return {
    asiItemId: Number(row.itemID),
    // Outlet whose rate row was kept: the item goes to that outlet's station.
    posId: row.posID != null ? Number(row.posID) : null,
    // Display PLU = ASI alias (PRES, ACR); stable key remains asi_item_id
    number: itemAlias || `ASI-${row.itemID}`,
    alias: itemAlias,
    name: String(row.itemName || '').trim() || `ASI Item ${row.itemID}`,
    priceUsd,
    price,
    taxes: resolveTaxes(row, captions),
    taxInclusive: row.isInclusiveTax === true || row.isInclusiveTax === 1,
    asiGroupId: Number(row.itemgroupID),
    groupAlias: alias,
    groupName,
    station: stationForGroup(alias, groupName),
    sales: row.sales === true || row.sales === 1,
    isActive: row.isActive === true || row.isActive === 1,
    isDeleted: row.isDeleted === true || row.isDeleted === 1,
  };
}

async function fetchHtgRate(pool) {
  const result = await pool.request().query(`
    SELECT TOP 1 exchangeRate
    FROM mExchangeRate
    WHERE currencySign = 'HTG' OR currencyName = 'HTG'
    ORDER BY exchangeRateID DESC
  `);
  const rate = Number(result.recordset[0]?.exchangeRate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function mapOutlet(row) {
  return {
    pos_id: Number(row.posID),
    alias: String(row.posAlias || '').trim(),
    name: String(row.posName || '').trim() || `POS ${row.posID}`,
    is_active: row.isActive === true || row.isActive === 1,
  };
}

/**
 * @param {object} asiConfig
 * @param {{ posIds?: number[] }} [opts] outlets picked in Manage, in priority
 *   order. Empty → ASI_POS_ID, else every outlet.
 */
async function fetchAsiCatalog(asiConfig, opts = {}) {
  let posIds = (opts.posIds || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (posIds.length === 0 && asiConfig.posId != null && Number.isFinite(asiConfig.posId)) {
    posIds = [Number(asiConfig.posId)];
  }

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
    const convertToHtg = asiConfig.priceToHtg === true;
    const fxHtg = convertToHtg ? await fetchHtgRate(pool) : null;
    const taxCaptions = await fetchTaxCaptions(pool);

    const groupsResult = await pool.request().query(`
      SELECT itemgroupID, itemgroupAlias, itemgroupName, isActive, isDeleted
      FROM mItemGroup
      WHERE isDeleted = 0
      ORDER BY itemgroupID
    `);

    let itemsSql = `
      SELECT
        i.itemID, i.itemAlias, i.itemName, i.sales, i.isActive, i.isDeleted,
        g.itemgroupID, g.itemgroupAlias, g.itemgroupName,
        p.itemPosID, p.posID,
        r.defaultRate, r.rate1, r.rate2, r.rate3, r.rate4, r.rate5,
        r.isDefaultUnit, r.isInclusiveTax,
        r.tax1, r.tax2, r.tax3, r.tax4, r.tax5,
        r.tax1On, r.tax2On, r.tax3On, r.tax4On, r.tax5On
      FROM mItem i
      INNER JOIN tItemPOS p ON p.itemID = i.itemID
      INNER JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
      LEFT JOIN mItemRate r ON r.itemPOSId = p.itemPosID
      WHERE i.isDeleted = 0
        AND g.isDeleted = 0
    `;
    if (posIds.length > 0) {
      itemsSql += ` AND p.posID IN (${posIds.join(', ')})`;
    }
    itemsSql += ` ORDER BY i.itemID`;

    const itemsResult = await pool.request().query(itemsSql);

    const outletsResult = await pool.request().query(`
      SELECT posID, posAlias, posName, isActive
      FROM mPOS
      WHERE isDeleted = 0
      ORDER BY posID
    `);
    const outlets = outletsResult.recordset.map(mapOutlet);

    // ASI modifiers are a flat, unpriced list (sides: RIZ, FRITES…) attached per item.
    const modifiersResult = await pool.request().query(`
      SELECT modifierID, modifierAlias, modifierName
      FROM mModifiers
      WHERE isDeleted = 0 AND isActive = 1
      ORDER BY modifierID
    `);
    const modifiers = modifiersResult.recordset.map((row) => ({
      asiModifierId: Number(row.modifierID),
      alias: String(row.modifierAlias || '').trim(),
      name: String(row.modifierName || '').trim() || `ASI Modifier ${row.modifierID}`,
    }));
    const itemModifiersResult = await pool.request().query(`
      SELECT itemID, modifierID
      FROM tItemModifier
      WHERE isActive = 1
    `);
    const itemModifiers = itemModifiersResult.recordset.map((row) => ({
      asiItemId: Number(row.itemID),
      asiModifierId: Number(row.modifierID),
    }));

    const groups = groupsResult.recordset
      .map(mapGroup)
      .filter((g) => g.asiGroupId !== 1);

    const allItems = dedupeItems(itemsResult.recordset, posIds).map((row) =>
      mapItem(row, fxHtg, taxCaptions),
    );
    const activeItems = allItems.filter((i) => i.sales && i.isActive && !i.isDeleted);
    const inactiveIds = allItems
      .filter((i) => !i.sales || !i.isActive || i.isDeleted)
      .map((i) => i.asiItemId);

    return {
      groups,
      activeItems,
      inactiveIds,
      outlets,
      modifiers,
      itemModifiers,
      meta: { fxHtg, priceCurrency: fxHtg ? 'HTG' : 'USD', taxCaptions, posIds },
    };
  } finally {
    await pool.close();
  }
}

module.exports = {
  fetchAsiCatalog,
  fetchTaxCaptions,
  resolvePriceUsd,
  resolveTaxes,
  dedupeItems,
};
