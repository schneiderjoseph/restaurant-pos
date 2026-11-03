'use strict';

/**
 * Compare charged prices on POSR orders vs ASI (BAR/Restaurant rates + matched tickets).
 *
 *   node asi-sync/scripts/compare-posr-asi-prices.cjs
 *   node asi-sync/scripts/compare-posr-asi-prices.cjs --days 14
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Surreal } = require('surrealdb');
const sql = require('mssql');

const ROOT = path.join(__dirname, '..', '..');
const MENU = path.join(ROOT, 'migrations', 'data', 'cormier-menu.json');

const daysArg = process.argv.indexOf('--days');
const DAYS = daysArg >= 0 ? Number(process.argv[daysArg + 1]) || 30 : 30;
const POS = { BAR: 2, Restaurant: 3, BARRESTO: 1 };

const DRINK_GROUP_RE =
  /^(EAUX|GAZEUSES|BIERE|BIÈRE|RHUM|VODKA|GIN|WHISKY|TEQUILA|COCKTAILS|LIQUEURS|VIN|CHAMPAGNE|JUS|CAFE\/THE|CAFÉ\/THÉ|ENERGY|SPORT|VERMONTH|COGNAC|Champagne Verre|PLAGE)/i;
const SKIP_GROUP_RE =
  /mariage|évènement|evenement|event|202[0-9]|buffet|n\/a|--n\/a--|prix ev|beach naval|couronne|prix par bouteille|massage|^w$|lang\. grillee poids|poisson entier\s*\/|room service/i;
const SKIP_NAME_RE =
  /\b(mariage|évènement|evenement|beach naval|px short|personnel|willair|robert\s*\d|matin personnel|midi personnel|diner\/|soiree|soirée|boutique|bottega)\b/i;
// BARRESTO often holds staff / internal low rates — never prefer over BAR or Restaurant.
const FALSE_FRIEND_RE =
  /\b(bouteille|btle|75\s*cl|700\s*ml|1\s*l\b|par\s*oz|\/oz|package|petit.?dej|breakfast)\b/i;

function money(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function norm(s) {
  return String(s || '')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'oe')
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

function guestParts(name) {
  return norm(name)
    .split(' ')
    .filter((p) => p.length >= 4);
}

function collectMenuMap(data) {
  const byNumber = new Map();
  for (const c of data.categories) {
    for (const it of c.items || []) {
      if (it.ref || !it.number) continue;
      byNumber.set(String(it.number), {
        name: it.name,
        number: String(it.number),
        price: Number(it.price),
        measure: !!it.measure_unit,
        outlet: c.outlet,
        asiIds: [
          ...(it.asi_item_id != null ? [Number(it.asi_item_id)] : []),
          ...((it.asi_item_ids || []).map(Number)),
        ].filter((n) => Number.isFinite(n)),
        variants: it.variants || [],
      });
    }
  }
  return byNumber;
}

function posRank(posId, wantPos) {
  const p = Number(posId);
  if (p === wantPos) return 40;
  if (p === POS.BAR) return 30;
  if (p === POS.Restaurant) return 20;
  if (p === POS.BARRESTO) return 5; // last resort — often internal rates
  return 0;
}

function pickAsiCatalog(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row.itemID);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row);
  }
  const out = new Map();
  for (const [id, list] of byId) {
    const name = String(list[0].itemName || '').trim();
    const alias = String(list[0].itemAlias || '').trim();
    if (SKIP_NAME_RE.test(name)) continue;
    const groups = [...new Set(list.map((r) => String(r.itemgroupName || '').trim()).filter(Boolean))];
    const usableGroups = groups.filter((g) => !SKIP_GROUP_RE.test(g));
    if (!usableGroups.length) continue;
    const drink = usableGroups.some((g) => DRINK_GROUP_RE.test(g));
    const wantPos = drink ? POS.BAR : POS.Restaurant;
    const candidates = list.filter((r) => !SKIP_GROUP_RE.test(String(r.itemgroupName || '')));
    const ranked = [...candidates].sort((a, b) => {
      const pa = Number(a.rate1) > 0 ? 1 : 0;
      const pb = Number(b.rate1) > 0 ? 1 : 0;
      if (pb !== pa) return pb - pa;
      const sa = posRank(a.posID, wantPos);
      const sb = posRank(b.posID, wantPos);
      if (sb !== sa) return sb - sa;
      // Tie-break: higher guest price (avoids BARRESTO staff rates)
      return Number(b.rate1) - Number(a.rate1);
    });
    const best = ranked.find((r) => Number(r.rate1) > 0);
    if (!best) continue;
    // Also keep BARRESTO rate for visibility
    const barresto = candidates.find((r) => Number(r.posID) === POS.BARRESTO && Number(r.rate1) > 0);
    out.set(id, {
      asiId: id,
      alias,
      name,
      group: String(best.itemgroupName || '-'),
      pos: String(best.posName || '-'),
      posId: Number(best.posID),
      price: money(best.rate1),
      barresto_price: barresto ? money(barresto.rate1) : null,
      rates_by_pos: Object.fromEntries(
        candidates
          .filter((r) => Number(r.rate1) > 0)
          .map((r) => [String(r.posID), money(r.rate1)]),
      ),
    });
  }
  return out;
}

function matchByName(posrName, asiCatalog) {
  const n = norm(posrName);
  if (!n) return null;
  let best = null;
  for (const asi of asiCatalog.values()) {
    const an = norm(asi.name);
    if (!an) continue;
    // Reject bottle/package false friends when POSR name has no such hint
    if (FALSE_FRIEND_RE.test(asi.name) && !FALSE_FRIEND_RE.test(posrName)) continue;
    let score = 0;
    if (an === n) score = 1;
    else if (an.startsWith(n + ' ') || n.startsWith(an + ' ')) score = 0.9;
    else if (an.includes(n) || n.includes(an)) {
      score = 0.8 * (Math.min(an.length, n.length) / Math.max(an.length, n.length));
    } else score = tokenScore(posrName, asi.name);
    if (score >= 0.86 && (!best || score > best.score)) best = { asi, score };
  }
  return best;
}

(async () => {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);
  console.log(`Comparing POSR order prices ↔ ASI since ${sinceDate} (${DAYS}d)…\n`);

  const menuJson = JSON.parse(fs.readFileSync(MENU, 'utf8'));
  const menuByNumber = collectMenuMap(menuJson);

  const db = new Surreal();
  await db.connect(process.env.SURREAL_URL);
  await db.signin({ username: process.env.SURREAL_USER, password: process.env.SURREAL_PASS });
  await db.use({ namespace: process.env.SURREAL_NS, database: process.env.SURREAL_DB });

  const [orders] = await db.query(
    `
    SELECT id, invoice_number, status, created_at, customer.name AS customer_name
    FROM order
    WHERE created_at >= $since
      AND (deleted_at = NONE OR deleted_at = NULL)
      AND status != 'Cancelled'
    `,
    { since: sinceIso },
  );

  const [rawLines] = await db.query(
    `
    SELECT id, order, name, quantity, price, created_at, item
    FROM order_item
    WHERE created_at >= $since
      AND (deleted_at = NONE OR deleted_at = NULL)
      AND quantity > 0
    FETCH item
    `,
    { since: sinceIso },
  );
  await db.close();

  const orderById = new Map((orders || []).map((o) => [String(o.id), o]));
  const lines = [];
  for (const row of rawLines || []) {
    const oid = String(row.order);
    if (!orderById.has(oid)) continue;
    const item = row.item && typeof row.item === 'object' ? row.item : null;
    lines.push({
      orderId: oid,
      name: item?.name || row.name,
      number: item?.number != null ? String(item.number) : null,
      quantity: Number(row.quantity) || 0,
      charged: money(row.price),
      catalog: item?.price != null ? money(item.price) : null,
      asi_item_id: item?.asi_item_id != null ? Number(item.asi_item_id) : null,
      measure: !!(item?.measure_unit),
      has_variants: Array.isArray(item?.variants) && item.variants.length > 0,
    });
  }
  console.log(`POSR: ${orderById.size} orders, ${lines.length} lines`);

  const pool = await sql.connect({
    server: process.env.ASI_SQL_SERVER,
    port: Number(process.env.ASI_SQL_PORT),
    database: process.env.ASI_SQL_DATABASE,
    user: process.env.ASI_SQL_USER,
    password: process.env.ASI_SQL_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
    requestTimeout: 180000,
  });

  const { recordset: asiRows } = await pool.request().query(`
    SELECT
      i.itemID, i.itemAlias, i.itemName, i.isActive,
      g.itemgroupName, pos.posID, pos.posName, r.rate1
    FROM mItem i
    INNER JOIN tItemPOS p ON p.itemID = i.itemID
    INNER JOIN mItemGroup g ON g.itemgroupID = p.itemgroupID
    INNER JOIN mPOS pos ON pos.posID = p.posID
    LEFT JOIN mItemRate r ON r.itemPOSId = p.itemPosID
    WHERE i.isDeleted = 0 AND g.isDeleted = 0 AND i.isActive = 1
      AND pos.posID IN (1, 2, 3)
  `);
  const asiCatalog = pickAsiCatalog(asiRows);
  console.log(`ASI catalog (priced): ${asiCatalog.size}`);

  const resolveCache = new Map();
  function resolveAsi(line) {
    const cacheKey = `${line.number || ''}|${norm(line.name)}|${line.asi_item_id || ''}`;
    if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey);

    if (line.asi_item_id && asiCatalog.has(line.asi_item_id)) {
      const r = { asiId: line.asi_item_id, how: 'db', score: 1 };
      resolveCache.set(cacheKey, r);
      return r;
    }
    const json = line.number ? menuByNumber.get(String(line.number)) : null;
    if (json?.asiIds?.length) {
      for (const id of json.asiIds) {
        if (asiCatalog.has(id)) {
          const r = { asiId: id, how: 'json', score: 1 };
          resolveCache.set(cacheKey, r);
          return r;
        }
      }
    }
    // Skip fuzzy for multi-variant / measure dishes (false friends)
    if (line.measure || line.has_variants) {
      resolveCache.set(cacheKey, null);
      return null;
    }
    const m = matchByName(line.name, asiCatalog);
    if (m && m.score >= 0.92) {
      const r = { asiId: m.asi.asiId, how: 'name', score: m.score };
      resolveCache.set(cacheKey, r);
      return r;
    }
    resolveCache.set(cacheKey, null);
    return null;
  }

  for (const line of lines) {
    const r = resolveAsi(line);
    line.resolved_asi_id = r?.asiId ?? null;
    line.resolve_how = r?.how ?? null;
    if (r) {
      const asi = asiCatalog.get(r.asiId);
      line.asi_name = asi.name;
      line.asi_rate = asi.price;
      line.asi_pos = `${asi.posId}:${asi.pos}`;
      line.asi_barresto = asi.barresto_price;
      line.delta = money(line.charged - asi.price);
    }
  }

  // Aggregate charged prices vs ASI guest rate
  const byItem = new Map();
  for (const line of lines) {
    if (line.measure || !line.resolved_asi_id) continue;
    const key = `asi:${line.resolved_asi_id}`;
    let row = byItem.get(key);
    if (!row) {
      row = {
        name: line.name,
        number: line.number,
        asi_item_id: line.resolved_asi_id,
        asi_name: line.asi_name,
        asi_pos: line.asi_pos,
        asi_rate: line.asi_rate,
        asi_barresto: line.asi_barresto,
        how: line.resolve_how,
        charged: new Map(),
        qty: 0,
        lines: 0,
        qty_below_asi: 0,
        qty_above_asi: 0,
        qty_equal: 0,
      };
      byItem.set(key, row);
    }
    row.lines += 1;
    row.qty += line.quantity;
    row.charged.set(line.charged, (row.charged.get(line.charged) || 0) + line.quantity);
    if (line.delta <= -1) row.qty_below_asi += line.quantity;
    else if (line.delta >= 1) row.qty_above_asi += line.quantity;
    else row.qty_equal += line.quantity;
  }

  const report = [...byItem.values()].map((r) => {
    const variants = [...r.charged.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([price, qty]) => ({ price, qty }));
    const main = variants[0]?.price ?? null;
    const delta = main != null ? money(main - r.asi_rate) : null;
    return {
      name: r.name,
      number: r.number,
      asi_item_id: r.asi_item_id,
      asi_name: r.asi_name,
      asi_pos: r.asi_pos,
      how: r.how,
      posr_main_price: main,
      charged_variants: variants,
      asi_rate: r.asi_rate,
      asi_barresto: r.asi_barresto,
      delta,
      qty: money(r.qty),
      qty_sold_below_asi: money(r.qty_below_asi),
      qty_sold_above_asi: money(r.qty_above_asi),
      qty_sold_equal: money(r.qty_equal),
      lower_than_asi: delta != null && delta <= -1,
      higher_than_asi: delta != null && delta >= 1,
      had_undercharge: r.qty_below_asi > 0,
    };
  });

  const underchargedItems = report
    .filter((r) => r.had_undercharge)
    .sort((a, b) => b.qty_sold_below_asi - a.qty_sold_below_asi);
  const lowerMain = report.filter((r) => r.lower_than_asi).sort((a, b) => a.delta - b.delta);
  const higherMain = report.filter((r) => r.higher_than_asi).sort((a, b) => b.delta - a.delta);
  const sameMain = report.filter((r) => r.delta != null && !r.lower_than_asi && !r.higher_than_asi);

  // —— Ticket matching ——
  const { recordset: salesRows } = await pool.request().query(`
    SELECT
      s.salesID, s.voucherNo, s.voucherDate, s.lastName, s.firstName, s.netAmount, s.POSId,
      t.itemID, i.itemName, t.quantity, t.rate
    FROM mSalesMaster s
    INNER JOIN tSalesTran t ON t.salesID = s.salesID
    INNER JOIN mItem i ON i.itemID = t.itemID
    WHERE s.voucherDate >= '${sinceDate}'
  `);
  await pool.close();
  console.log(`ASI sale lines since ${sinceDate}: ${salesRows.length}`);

  const asiTickets = new Map();
  for (const row of salesRows) {
    let t = asiTickets.get(row.salesID);
    if (!t) {
      const name = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
      const dayRaw = row.voucherDate instanceof Date
        ? row.voucherDate.toISOString()
        : String(row.voucherDate);
      t = {
        salesID: row.salesID,
        voucherNo: row.voucherNo,
        day: dayRaw.slice(0, 10),
        name,
        parts: new Set(guestParts(name)),
        netAmount: money(row.netAmount),
        posId: row.POSId,
        qtyByItem: new Map(),
        rateByItem: new Map(),
      };
      asiTickets.set(row.salesID, t);
    }
    const id = Number(row.itemID);
    const qty = Number(row.quantity) || 0;
    t.qtyByItem.set(id, (t.qtyByItem.get(id) || 0) + qty);
    // Prefer BAR rates if same item appears twice (shouldn't) — keep last
    t.rateByItem.set(id, money(row.rate));
  }
  const asiByDay = new Map();
  for (const t of asiTickets.values()) {
    if (!asiByDay.has(t.day)) asiByDay.set(t.day, []);
    asiByDay.get(t.day).push(t);
  }
  console.log(`ASI tickets: ${asiTickets.size} across ${asiByDay.size} days`);

  const linesByOrder = new Map();
  for (const l of lines) {
    if (!linesByOrder.has(l.orderId)) linesByOrder.set(l.orderId, []);
    linesByOrder.get(l.orderId).push(l);
  }

  const matches = [];
  let unmatchedOrders = 0;
  for (const [oid, order] of orderById) {
    const ols = (linesByOrder.get(oid) || []).filter((l) => l.resolved_asi_id && !l.measure);
    if (ols.length < 1) {
      unmatchedOrders += 1;
      continue;
    }
    const day = String(order.created_at).slice(0, 10);
    const d1 = new Date(`${day}T12:00:00Z`);
    const prev = new Date(d1);
    prev.setUTCDate(prev.getUTCDate() - 1);
    const next = new Date(d1);
    next.setUTCDate(next.getUTCDate() + 1);
    const days = [prev.toISOString().slice(0, 10), day, next.toISOString().slice(0, 10)];
    const candidates = days.flatMap((d) => asiByDay.get(d) || []);

    const qtyByAsi = new Map();
    for (const l of ols) {
      qtyByAsi.set(l.resolved_asi_id, (qtyByAsi.get(l.resolved_asi_id) || 0) + l.quantity);
    }
    const parts = new Set(guestParts(order.customer_name));

    let best = null;
    for (const t of candidates) {
      let overlap = 0;
      let total = 0;
      for (const [aid, qty] of qtyByAsi) {
        total += qty;
        overlap += Math.min(qty, t.qtyByItem.get(aid) || 0);
      }
      if (overlap <= 0) continue;
      let score = (overlap / Math.max(total, 1)) * 100;
      let sharedName = 0;
      for (const p of parts) if (t.parts.has(p)) sharedName += 1;
      score += sharedName * 20;
      // Bonus if item set size matches closely
      score -= Math.abs(t.qtyByItem.size - qtyByAsi.size) * 3;
      if (!best || score > best.score) best = { t, score, overlap, total };
    }

    if (!best || best.overlap < Math.max(1, best.total * 0.45) || best.score < 40) {
      unmatchedOrders += 1;
      continue;
    }

    const diffs = [];
    for (const l of ols) {
      const asiRate = best.t.rateByItem.get(l.resolved_asi_id);
      if (asiRate == null) continue;
      const delta = money(l.charged - asiRate);
      if (Math.abs(delta) >= 1) {
        diffs.push({
          name: l.name,
          number: l.number,
          asi_item_id: l.resolved_asi_id,
          qty: l.quantity,
          posr: l.charged,
          asi_ticket: asiRate,
          delta,
        });
      }
    }
    matches.push({
      invoice: order.invoice_number,
      day,
      customer: order.customer_name,
      asi_voucher: best.t.voucherNo,
      asi_salesID: best.t.salesID,
      asi_name: best.t.name,
      asi_pos: best.t.posId,
      score: money(best.score),
      price_diffs: diffs,
    });
  }

  const ticketDiffs = matches.filter((m) => m.price_diffs.length);
  const ticketAgg = new Map();
  for (const m of ticketDiffs) {
    for (const d of m.price_diffs) {
      const k = `${d.asi_item_id}:${d.posr}:${d.asi_ticket}`;
      let a = ticketAgg.get(k);
      if (!a) {
        a = { ...d, orders: 0, invoices: [] };
        ticketAgg.set(k, a);
      }
      a.orders += 1;
      if (a.invoices.length < 12) a.invoices.push(m.invoice);
    }
  }

  const out = {
    generated_at: new Date().toISOString(),
    window_days: DAYS,
    since: sinceDate,
    note:
      'ASI guest rates prefer BAR (drinks/plage) or Restaurant (food). BARRESTO is often a lower internal rate and is shown separately.',
    summary: {
      posr_orders: orderById.size,
      posr_lines: lines.length,
      lines_mapped_to_asi: lines.filter((l) => l.resolved_asi_id).length,
      matched_orders: matches.length,
      unmatched_orders: unmatchedOrders,
      items_main_price_lower: lowerMain.length,
      items_main_price_higher: higherMain.length,
      items_main_price_same: sameMain.length,
      items_with_any_undercharge_qty: underchargedItems.length,
      matched_orders_with_price_diffs: ticketDiffs.length,
    },
    // What staff report: sold cheaper than ASI guest rate
    sold_below_asi_guest_rate: underchargedItems,
    catalog_main_lower: lowerMain,
    catalog_main_higher: higherMain,
    catalog_main_same: sameMain,
    ticket_line_diffs: [...ticketAgg.values()].sort((a, b) => a.delta - b.delta || b.orders - a.orders),
    sample_matched_with_diffs: ticketDiffs.slice(0, 50),
    sample_matched_ok: matches.filter((m) => !m.price_diffs.length).slice(0, 20),
  };

  const outPath = path.join(__dirname, `compare-posr-asi-prices-${sinceDate}_to_today.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(out.summary, null, 2));

  console.log('\n=== SOLD BELOW ASI guest rate (qty undercharged) ===');
  if (!underchargedItems.length) console.log('  (none)');
  for (const r of underchargedItems) {
    const vars = r.charged_variants.map((v) => `${v.price}×${v.qty}`).join(', ');
    console.log(
      `  #${r.number}  ${r.name}  ASI ${r.asi_rate} (${r.asi_pos})  charged:[${vars}]  underqty=${r.qty_sold_below_asi}/${r.qty}`,
    );
  }

  console.log('\n=== Main charged price LOWER than ASI ===');
  if (!lowerMain.length) console.log('  (none)');
  for (const r of lowerMain) {
    console.log(`  #${r.number}  ${r.name}  POSR ${r.posr_main_price} < ASI ${r.asi_rate} (Δ ${r.delta})`);
  }

  console.log('\n=== Main charged price HIGHER than ASI ===');
  if (!higherMain.length) console.log('  (none)');
  for (const r of higherMain) {
    console.log(`  #${r.number}  ${r.name}  POSR ${r.posr_main_price} > ASI ${r.asi_rate} (Δ +${r.delta}) [${r.how}]`);
  }

  console.log('\n=== Matched ASI tickets — line price diffs ===');
  if (![...ticketAgg.values()].length) console.log('  (none)');
  for (const r of [...ticketAgg.values()].sort((a, b) => a.delta - b.delta)) {
    console.log(
      `  #${r.number}  ${r.name}  POSR ${r.posr} vs ASI ticket ${r.asi_ticket} (Δ ${r.delta})  ×${r.orders} (#${r.invoices.join(',')})`,
    );
  }

  console.log(`\nMatched OK sample: ${out.sample_matched_ok.map((m) => `#${m.invoice}→${m.asi_voucher}`).join(', ') || '(none)'}`);
  console.log(`JSON: ${outPath}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
