'use strict';

/**
 * Excel: articles POSR — 3 feuilles (Bar, Restaurant, Plage), catégories en colonne.
 *
 *   node asi-sync/scripts/export-posr-menu-prices-xlsx.cjs
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Surreal } = require('surrealdb');
const XLSX = require(path.join(__dirname, '..', '..', 'node_modules', 'xlsx'));

const OUTLET_SHEETS = [
  { key: 'bar', title: 'Bar', match: /bar/i },
  { key: 'restaurant', title: 'Restaurant', match: /restaurant|resto/i },
  { key: 'plage', title: 'Plage', match: /plage/i },
];

function outletKey(raw) {
  const s = String(raw || '')
    .replace(/^outlet:/i, '')
    .trim()
    .toLowerCase();
  for (const o of OUTLET_SHEETS) {
    if (o.match.test(s)) return o.key;
  }
  return 'autre';
}

function outletLabel(raw) {
  if (!raw) return '';
  if (typeof raw === 'object') return raw.name || String(raw.id || '').replace(/^outlet:/i, '');
  return String(raw).replace(/^outlet:/i, '');
}

(async () => {
  const db = new Surreal();
  await db.connect(process.env.SURREAL_URL);
  await db.signin({ username: process.env.SURREAL_USER, password: process.env.SURREAL_PASS });
  await db.use({ namespace: process.env.SURREAL_NS, database: process.env.SURREAL_DB });

  const [cats] = await db.query(`
    SELECT id, name, priority, outlet, outlet.name AS outlet_name
    FROM category
    WHERE deleted_at = NONE OR deleted_at = NULL
    ORDER BY priority ASC, name ASC
  `);

  const [dishes] = await db.query(`
    SELECT id, name, price, asi_item_id, source, priority,
           categories, variants, measure_unit, measure_default
    FROM menu_item
    WHERE deleted_at = NONE OR deleted_at = NULL
    ORDER BY priority ASC, name ASC
    FETCH categories, categories.outlet
  `);
  await db.close();

  const catMeta = new Map();
  for (const c of cats || []) {
    const outletRaw = c.outlet_name || outletLabel(c.outlet);
    catMeta.set(String(c.id), {
      name: c.name || String(c.id),
      priority: c.priority ?? 9999,
      outletRaw,
      outlet: outletKey(outletRaw),
    });
  }

  /** @type {Map<string, object[]>} */
  const byOutlet = new Map(OUTLET_SHEETS.map((o) => [o.key, []]));
  byOutlet.set('autre', []);

  for (const d of dishes || []) {
    const catList = Array.isArray(d.categories) && d.categories.length
      ? d.categories
      : [{ id: null, name: '(Sans catégorie)' }];

    for (const cat of catList) {
      const cid = cat && typeof cat === 'object' ? String(cat.id) : String(cat || '');
      const meta = catMeta.get(cid) || {
        name: (cat && cat.name) || '(Sans catégorie)',
        priority: 9999,
        outletRaw: outletLabel(cat?.outlet),
        outlet: outletKey(outletLabel(cat?.outlet)),
      };

      const base = {
        _catPriority: meta.priority,
        Catégorie: meta.name,
        Article: d.name || '',
        Variante: '',
        'Prix POSR (HTG)': Number(d.price) || 0,
        Unité: d.measure_unit || '',
        'Mesure défaut': d.measure_unit != null ? d.measure_default ?? '' : '',
        'Prix correct (à confirmer)': '',
        'OK ?': '',
        Commentaire: '',
      };

      const variants = Array.isArray(d.variants) ? d.variants : [];
      const bucket = byOutlet.get(meta.outlet) || byOutlet.get('autre');
      if (variants.length) {
        for (const v of variants) {
          bucket.push({
            ...base,
            Variante: v.name || '',
            'Prix POSR (HTG)': v.price != null ? Number(v.price) : base['Prix POSR (HTG)'],
          });
        }
      } else {
        bucket.push(base);
      }
    }
  }

  const sortRows = (rows) => {
    rows.sort(
      (a, b) =>
        a._catPriority - b._catPriority ||
        String(a.Catégorie).localeCompare(String(b.Catégorie), 'fr') ||
        String(a.Article).localeCompare(String(b.Article), 'fr') ||
        String(a.Variante).localeCompare(String(b.Variante), 'fr'),
    );
    return rows.map(({ _catPriority, ...r }) => r);
  };

  const wb = XLSX.utils.book_new();
  const cols = [
    { wch: 28 }, { wch: 36 }, { wch: 18 }, { wch: 14 }, { wch: 10 },
    { wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 32 },
  ];

  let total = 0;
  for (const o of OUTLET_SHEETS) {
    const rows = sortRows(byOutlet.get(o.key) || []);
    total += rows.length;
    const ws = XLSX.utils.json_to_sheet(
      rows.length
        ? rows
        : [{ Catégorie: '', Article: '(aucun article)', Variante: '', 'Prix POSR (HTG)': '', Unité: '', 'Mesure défaut': '', 'Prix correct (à confirmer)': '', 'OK ?': '', Commentaire: '' }],
    );
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, o.title);
  }

  const autres = sortRows(byOutlet.get('autre') || []);
  if (autres.length) {
    total += autres.length;
    const ws = XLSX.utils.json_to_sheet(autres);
    ws['!cols'] = cols;
    XLSX.utils.book_append_sheet(wb, ws, 'Autre');
  }

  const outDir = path.join(__dirname, '..', '..', 'reports');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `POSR-menu-prix-par-categorie-${stamp}.xlsx`);
  XLSX.writeFile(wb, outPath);

  console.log(`Wrote ${outPath}`);
  console.log(
    `Bar=${(byOutlet.get('bar') || []).length} Restaurant=${(byOutlet.get('restaurant') || []).length} Plage=${(byOutlet.get('plage') || []).length} Autre=${autres.length} total=${total}`,
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
