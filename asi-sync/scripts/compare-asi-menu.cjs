'use strict';

/**
 * Compare ASI (read-only) with migrations/data/cormier-menu.json.
 * Drinks → BAR; food → Restaurant.
 *
 *   node asi-sync/scripts/compare-asi-menu.cjs
 *   node asi-sync/scripts/compare-asi-menu.cjs --json
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const sql = require('mssql');

const ROOT = path.join(__dirname, '..', '..');
const AS_JSON = process.argv.includes('--json');
const POS = { BAR: 2, Restaurant: 3, BARRESTO: 1 };

const DRINK_GROUP_RE =
  /^(EAUX|GAZEUSES|BIERE|BIÈRE|RHUM|VODKA|GIN|WHISKY|TEQUILA|COCKTAILS|LIQUEURS|VIN|CHAMPAGNE|JUS|CAFE\/THE|CAFÉ\/THÉ|ENERGY|SPORT|VERMONTH|COGNAC|Champagne Verre)/i;

const SKIP_GROUP_RE =
  /mariage|évènement|evenement|event|202[0-9]|buffet|n\/a|--n\/a--|prix ev|beach naval|couronne|prix par bouteille|massage|w$|^w$|lang\. grillee poids|poisson entier\s*\/|room service/i;

const SKIP_NAME_RE =
  /\b(mariage|évènement|evenement|beach naval|px short|personnel|willair|robert\s*\d|matin personnel|midi personnel|diner\/|soiree|soirée|\d+\s*oz|\d{2,3}\s*$|boutique|bottega)/i;

function norm(s) {
  return String(s || '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`*★]+/g, '')
    .replace(/\b(plat de|plats de|jus de|jus d|jus|plat|plats|creme|the|le|la|les|de|du|des|et|au|aux|a)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return norm(s).split(' ').filter((t) => t.length > 1);
}

function tokenScore(a, b) {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

function isDrinkGroup(group) {
  return DRINK_GROUP_RE.test(String(group || '').trim());
}

function collectMenuDishes(data) {
  const dishes = [];
  for (const c of data.categories) {
    for (const it of c.items || []) {
      if (it.ref) continue;
      const base = {
        name: it.name,
        number: String(it.number),
        price: Number(it.price),
        category: c.name,
        categoryKey: c.key,
        outlet: c.outlet,
        measure: !!it.measure_unit,
        asiIds: [
          ...(it.asi_item_id != null ? [Number(it.asi_item_id)] : []),
          ...((it.asi_item_ids || []).map(Number)),
        ].filter((n) => Number.isFinite(n)),
        variants: (it.variants || []).map((v) => ({
          name: v.name,
          price: Number(v.price ?? it.price),
        })),
      };
      dishes.push(base);
    }
  }
  return dishes;
}

async function fetchAsiRows(pool) {
  const { recordset } = await pool.request().query(`
    SELECT
      i.itemID, i.itemName, i.isActive,
      g.itemgroupName, pos.posID, pos.posName, r.rate1
    FROM mItem i
    INNER JOIN tItemPOS p ON p.itemID = i.itemID
    INNER JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
    INNER JOIN mPOS pos ON pos.posID = p.posID
    LEFT JOIN mItemRate r ON r.itemPOSId = p.itemPosID
    WHERE i.isDeleted = 0 AND g.isDeleted = 0 AND i.isActive = 1
      AND pos.posID IN (1, 2, 3)
    ORDER BY i.itemID, pos.posID
  `);
  return recordset;
}

function pickAsiCatalog(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row.itemID);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row);
  }
  const out = [];
  for (const [id, list] of byId) {
    const name = String(list[0].itemName || '').trim();
    if (SKIP_NAME_RE.test(name)) continue;

    const groups = [...new Set(list.map((r) => String(r.itemgroupName || '').trim()).filter(Boolean))];
    const usableGroups = groups.filter((g) => !SKIP_GROUP_RE.test(g));
    if (!usableGroups.length) continue;

    const drink = usableGroups.some(isDrinkGroup);
    const wantPos = drink ? POS.BAR : POS.Restaurant;
    const candidates = list.filter((r) => !SKIP_GROUP_RE.test(String(r.itemgroupName || '')));
    if (!candidates.length) continue;

    const ranked = [...candidates].sort((a, b) => {
      const pa = Number(a.rate1) > 0 ? 1 : 0;
      const pb = Number(b.rate1) > 0 ? 1 : 0;
      if (pb !== pa) return pb - pa;
      const sa = Number(a.posID) === wantPos ? 3 : Number(a.posID) === POS.BARRESTO ? 1 : 0;
      const sb = Number(b.posID) === wantPos ? 3 : Number(b.posID) === POS.BARRESTO ? 1 : 0;
      return sb - sa;
    });
    const best = ranked.find((r) => Number(r.rate1) > 0);
    if (!best) continue;

    out.push({
      asiId: id,
      name,
      group: String(best.itemgroupName || '-'),
      pos: String(best.posName || '-'),
      price: Number(best.rate1),
      drink,
    });
  }
  return out;
}

function pickOurPrice(dish, asiName) {
  if (!dish.variants?.length) return { price: dish.price, label: dish.name };
  const n = norm(asiName);
  const bottle = dish.variants.find((v) => /bouteille|btle|bottle/i.test(v.name));
  const shot = dish.variants.find((v) => /shot|verre|glass/i.test(v.name));
  if (/bouteille|btle|\/btle|75\s*cl|700\s*ml|1\s*l\b/i.test(asiName) && bottle) {
    return { price: bottle.price, label: `${dish.name} / ${bottle.name}` };
  }
  if (/shot|verre/i.test(asiName) && shot) {
    return { price: shot.price, label: `${dish.name} / ${shot.name}` };
  }
  if (bottle && n.includes('bouteille')) return { price: bottle.price, label: `${dish.name} / ${bottle.name}` };
  // Default compare to first / cheapest variant display price on tile
  const price = Math.min(...dish.variants.map((v) => v.price));
  const v = dish.variants.find((x) => x.price === price) || dish.variants[0];
  return { price, label: `${dish.name} / ${v.name}` };
}

function matchMenu(asi, menuByAsi, dishes) {
  const byId = menuByAsi.get(asi.asiId);
  if (byId?.length) return { dish: byId[0], how: 'asi_item_id', score: 1 };

  const n = norm(asi.name);
  let best = null;
  for (const dish of dishes) {
    const candidates = [dish.name, ...(dish.variants || []).map((v) => `${dish.name} ${v.name}`)];
    for (const c of candidates) {
      const cn = norm(c);
      if (!cn) continue;
      let score = 0;
      if (cn === n) score = 1;
      else if (cn.includes(n) || n.includes(cn)) score = 0.85 * (Math.min(cn.length, n.length) / Math.max(cn.length, n.length));
      else score = tokenScore(asi.name, c);
      if (score >= 0.72 && (!best || score > best.score)) best = { dish, how: score >= 0.99 ? 'name' : 'fuzzy', score };
    }
  }
  return best;
}

function compare(asiItems, dishes) {
  const menuByAsi = new Map();
  for (const d of dishes) {
    for (const id of d.asiIds) {
      if (!menuByAsi.has(id)) menuByAsi.set(id, []);
      menuByAsi.get(id).push(d);
    }
  }

  const missing = [];
  const priceDiffs = [];
  const matched = [];

  for (const asi of asiItems) {
    const m = matchMenu(asi, menuByAsi, dishes);
    if (!m) {
      missing.push(asi);
      continue;
    }
    // Skip false friends: weight SKU matched to per-oz dish, bottle to shot-only without bottle variant
    if (m.dish.measure && /\b\d{2,3}\b/.test(asi.name)) {
      matched.push({ asi, menu: m.dish, how: m.how, skippedPrice: true });
      continue;
    }
    matched.push({ asi, menu: m.dish, how: m.how });
    const our = pickOurPrice(m.dish, asi.name);
    if (Math.abs(our.price - asi.price) >= 1) {
      priceDiffs.push({
        asiId: asi.asiId,
        asiName: asi.name,
        group: asi.group,
        pos: asi.pos,
        asiPrice: asi.price,
        ourName: our.label,
        ourNumber: m.dish.number,
        ourCategory: m.dish.category,
        ourPrice: our.price,
        delta: our.price - asi.price,
        how: m.how,
        score: m.score,
      });
    }
  }

  // Reliable price diffs: linked id or strong name match
  const reliableDiffs = priceDiffs.filter((d) => d.how === 'asi_item_id' || d.how === 'name' || (d.how === 'fuzzy' && d.score >= 0.9));

  return { missing, priceDiffs: reliableDiffs, allDiffs: priceDiffs, matched };
}

function byGroup(list) {
  const m = new Map();
  for (const x of list) {
    if (!m.has(x.group)) m.set(x.group, []);
    m.get(x.group).push(x);
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function printHuman(asiItems, dishes, report) {
  const drinks = report.missing.filter((x) => x.drink).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const food = report.missing.filter((x) => !x.drink).sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  const diffs = [...report.priceDiffs].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  console.log('Comparaison ASI ↔ menu Cormier (bruit filtré : mariage, événements, poids/oz, PX short, buffet…)');
  console.log(`ASI retenus (actifs, prix > 0) : ${asiItems.length}`);
  console.log(`Menu (plats racine)            : ${dishes.length}`);
  console.log(`Appariés                       : ${report.matched.length}`);
  console.log(`Manquants                      : ${report.missing.length} (boissons ${drinks.length}, plats ${food.length})`);
  console.log(`Écarts de prix fiables         : ${diffs.length}`);
  console.log('');

  console.log('=== MANQUANTS — Boissons (prix BAR) ===');
  for (const [g, items] of byGroup(drinks)) {
    console.log(`\n[${g}]`);
    for (const x of items) console.log(`  #${x.asiId}  ${x.name}  |  ${x.price}`);
  }

  console.log('\n=== MANQUANTS — Plats (prix Restaurant) ===');
  for (const [g, items] of byGroup(food)) {
    console.log(`\n[${g}]`);
    for (const x of items) console.log(`  #${x.asiId}  ${x.name}  |  ${x.price}`);
  }

  console.log('\n=== ÉCARTS DE PRIX (nous − ASI), matches fiables ===');
  if (!diffs.length) console.log('(aucun)');
  for (const d of diffs) {
    const sign = d.delta > 0 ? '+' : '';
    console.log(
      `  #${d.asiId}  ${d.asiName}  |  ASI ${d.asiPrice}  →  nous ${d.ourPrice}  ` +
        `[${d.ourNumber} ${d.ourName} / ${d.ourCategory}]  Δ ${sign}${d.delta}  (${d.how})`,
    );
  }
}

(async () => {
  const menu = JSON.parse(fs.readFileSync(path.join(ROOT, 'migrations', 'data', 'cormier-menu.json'), 'utf8'));
  const dishes = collectMenuDishes(menu);
  const pool = await sql.connect({
    server: process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_SQL_PORT),
    database: process.env.ASI_SQL_DATABASE,
    user: process.env.ASI_SQL_USER,
    password: process.env.ASI_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });
  try {
    const asiItems = pickAsiCatalog(await fetchAsiRows(pool));
    const report = compare(asiItems, dishes);
    if (AS_JSON) {
      console.log(JSON.stringify({
        asiCount: asiItems.length,
        menuCount: dishes.length,
        matched: report.matched.length,
        missing: report.missing,
        priceDiffs: report.priceDiffs,
      }, null, 2));
    } else {
      printHuman(asiItems, dishes, report);
    }
  } finally {
    await pool.close();
  }
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
