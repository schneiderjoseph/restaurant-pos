'use strict';

/**
 * Apply curated ASI gaps into migrations/data/cormier-menu.json:
 * true missing items (categorized) + reliable price alignments.
 *
 *   node asi-sync/scripts/apply-asi-gaps.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MENU = path.join(ROOT, 'migrations', 'data', 'cormier-menu.json');

/** @type {{ category: string, name: string, price: number, number: string, asi_item_id?: number, sides?: boolean|false, variants?: any[], createCategory?: object }[]} */
const ADD = [
  // —— Bières ——
  { category: 'bieres', name: 'Guinness', price: 450, number: '1707', asi_item_id: 6721 },

  // —— Gazeuses ——
  { category: 'soft', name: 'Coca Diet', price: 250, number: '1865', asi_item_id: 10 },
  { category: 'soft', name: 'Sprite Zero', price: 120, number: '1866', asi_item_id: 472 },
  { category: 'soft', name: 'Fanta Orange', price: 120, number: '1867', asi_item_id: 267 },

  // —— Eaux ——
  { category: 'eaux', name: 'Eau de coco', price: 250, number: '1813', asi_item_id: 450 },

  // —— Jus ——
  { category: 'jus_naturels', name: 'Jus de cerise', price: 500, number: '1857', asi_item_id: 15 },
  { category: 'jus_naturels', name: 'Fresco', price: 500, number: '1858', asi_item_id: 478 },
  { category: 'jus_naturels', name: "Greg's Special", price: 500, number: '1859', asi_item_id: 576 },
  { category: 'jus_naturels', name: 'V8 Tomate', price: 250, number: '1860', asi_item_id: 29 },

  // —— Café / Thé (nouvelle cat.) ——
  {
    category: 'cafe_the',
    createCategory: { key: 'cafe_the', name: 'Café & Thé', outlet: 'bar', priority: 247 },
    name: 'Café au lait', price: 450, number: '1881', asi_item_id: 469,
  },
  { category: 'cafe_the', name: 'Café régulier', price: 425, number: '1882', asi_item_id: 552 },
  { category: 'cafe_the', name: 'Expresso', price: 400, number: '1883', asi_item_id: 643 },
  { category: 'cafe_the', name: 'Expresso large', price: 450, number: '1884', asi_item_id: 550 },
  { category: 'cafe_the', name: 'Thé', price: 188, number: '1885', asi_item_id: 444 },
  { category: 'cafe_the', name: 'Ice tea fresh', price: 545, number: '1886', asi_item_id: 586 },

  // —— Cocktails classiques ——
  { category: 'cocktails_classiques', name: 'Manhattan / White', price: 1200, number: '1647', asi_item_id: 628 },
  { category: 'cocktails_classiques', name: 'Manhattan / Jack Daniel', price: 1650, number: '1648', asi_item_id: 629 },
  { category: 'cocktails_classiques', name: 'Manhattan / Black', price: 1850, number: '1649', asi_item_id: 630 },
  { category: 'cocktails_classiques', name: 'Screwdriver / Absolut', price: 1500, number: '1650', asi_item_id: 635 },
  { category: 'cocktails_classiques', name: 'Screwdriver / Grey Goose', price: 2100, number: '1651', asi_item_id: 636 },
  { category: 'cocktails_classiques', name: 'Screwdriver / Stolichnaya', price: 1400, number: '1652', asi_item_id: 634 },
  { category: 'cocktails_classiques', name: 'Cranberry Daiquiri', price: 575, number: '1653', asi_item_id: 627 },
  { category: 'cocktails_classiques', name: 'White Russian / Grey Goose', price: 1734, number: '1654', asi_item_id: 632 },
  { category: 'cocktails_classiques', name: 'White Russian / Stolichnaya', price: 800, number: '1655', asi_item_id: 554 },

  // —— Cocktails rhum ——
  { category: 'cocktails_rhum', name: 'Cuba Libre 3 ★★★ Double', price: 928, number: '1656', asi_item_id: 417 },
  { category: 'cocktails_rhum', name: 'Cuba Libre 5 ★★★★★ Double', price: 1624, number: '1657', asi_item_id: 419 },
  { category: 'cocktails_rhum', name: 'Malibu & Coke', price: 400, number: '1658', asi_item_id: 610 },

  // —— Cocktails gin ——
  { category: 'cocktails_gin', name: 'Gin Fizz / Beefeater', price: 900, number: '1659', asi_item_id: 601 },
  { category: 'cocktails_gin', name: 'Gin Fizz / Gordon', price: 1300, number: '1660', asi_item_id: 602 },
  { category: 'cocktails_gin', name: 'Gin Fizz / Tanqueray', price: 1300, number: '1661', asi_item_id: 603 },

  // —— Cocktails vodka ——
  { category: 'cocktails_vodka', name: 'Vodka Cranberry / Absolut', price: 805, number: '1662', asi_item_id: 596 },
  { category: 'cocktails_vodka', name: 'Vodka Cranberry / Stolichnaya', price: 788, number: '1663', asi_item_id: 597 },
  { category: 'cocktails_vodka', name: 'Vodka Tonic / Absolut', price: 928, number: '1664', asi_item_id: 616 },
  { category: 'cocktails_vodka', name: 'Vodka Tonic / Stolichnaya', price: 928, number: '1665', asi_item_id: 615 },
  { category: 'cocktails_vodka', name: 'Vodka Tonic / Grey Goose', price: 928, number: '1666', asi_item_id: 617 },
  { category: 'cocktails_vodka', name: 'Vodka and Coke', price: 700, number: '1667', asi_item_id: 1672 },

  // —— Cocktails whisky ——
  { category: 'cocktails_whisky', name: 'Glenfiddich Sour', price: 1680, number: '1668', asi_item_id: 6893 },
  { category: 'cocktails_whisky', name: 'Whisky and Coke', price: 928, number: '1669', asi_item_id: 638 },

  // —— Cocktails tequila ——
  { category: 'cocktails_tequila', name: 'Tequila Sunrise / Cuervo Gold', price: 1350, number: '1670', asi_item_id: 542 },
  { category: 'cocktails_tequila', name: 'Tequila Sunrise / Cuervo Silver', price: 1350, number: '1671', asi_item_id: 633 },

  // —— Apéritifs ——
  { category: 'aperitifs', name: 'Campari', price: 740, number: '2514', asi_item_id: 39,
    variants: [{ name: 'Shot 2 oz', price: 740, from: '2514', ask_quantity: true }] },
  { category: 'aperitifs', name: 'Martini blanc', price: 640, number: '2515', asi_item_id: 68,
    variants: [{ name: 'Shot 2 oz', price: 640, from: '2515', ask_quantity: true }] },
  { category: 'aperitifs', name: 'Martini rouge', price: 640, number: '2516', asi_item_id: 69,
    variants: [{ name: 'Shot 2 oz', price: 640, from: '2516', ask_quantity: true }] },

  // —— Cognac / liqueurs ——
  { category: 'cognac', name: 'Alizé', price: 1000, number: '2407', asi_item_id: 6882,
    variants: [{ name: 'Shot 2 oz', price: 1000, from: '2407', ask_quantity: true }] },
  { category: 'liqueurs', name: 'Kahlua', price: 700, number: '2517', asi_item_id: 5721,
    variants: [{ name: 'Shot 2 oz', price: 700, from: '2517', ask_quantity: true }] },
  { category: 'liqueurs', name: 'Menthe verte', price: 558, number: '2512', asi_item_id: 70,
    variants: [{ name: 'Shot 2 oz', price: 558, from: '2512', ask_quantity: true }] },
  { category: 'liqueurs', name: 'Chocolat', price: 407, number: '2513', asi_item_id: 31,
    variants: [{ name: 'Shot 2 oz', price: 407, from: '2513', ask_quantity: true }] },

  // —— Tequila ——
  { category: 'tequila', name: 'Tequila Patron', price: 1307, number: '2310', asi_item_id: 612,
    variants: [{ name: 'Shot 2 oz', price: 1307, from: '2310', ask_quantity: true }] },

  // —— Champagnes ——
  { category: 'champagnes', name: 'Laurent-Perrier Brut – bouteille', price: 9896, number: '2909', asi_item_id: 608 },
  { category: 'champagnes', name: 'Laurent-Perrier ½ bouteille', price: 6115, number: '2910', asi_item_id: 651 },
  { category: 'champagnes', name: 'Verre Champagne', price: 800, number: '2911', asi_item_id: 6887 },
  { category: 'champagnes', name: 'Zonin Prosecco', price: 1000, number: '2912', asi_item_id: 46 },

  // —— Vins manquants (verre/bouteille utiles) ——
  { category: 'vins_blancs', name: 'Château Amandier', price: 800, number: '2609', asi_item_id: 6733,
    variants: [
      { name: 'Verre', price: 800, from: '2609' },
      { name: 'Bouteille', price: 4082, from: '2610' },
    ] },
  { category: 'vins_rouges', name: 'Château Pey Latour – bouteille', price: 1740, number: '2712', asi_item_id: 463 },
  { category: 'vins_blancs', name: "L'Hortus blanc – bouteille", price: 3087, number: '2611', asi_item_id: 570 },
  { category: 'vins_rouges', name: 'Montmeyrac', price: 375, number: '2713', asi_item_id: 67,
    variants: [
      { name: 'Verre', price: 375, from: '2713' },
      { name: 'Bouteille', price: 2250, from: '2714' },
    ] },
  { category: 'vins_blancs', name: 'Sancerre blanc – bouteille', price: 3500, number: '2612', asi_item_id: 85 },
  { category: 'vins_rouges', name: 'Verdillac rouge – bouteille', price: 2280, number: '2710', asi_item_id: 94 },
  { category: 'vins_blancs', name: 'Verdillac blanc – bouteille', price: 2280, number: '2711', asi_item_id: 93 },

  // —— Entrées ——
  { category: 'entrees', name: 'Cocktail de crevettes', price: 1750, number: '206', asi_item_id: 195 },
  { category: 'entrees', name: 'Salade Cormier', price: 1200, number: '207', asi_item_id: 193 },
  { category: 'entrees', name: 'Salade de poisson', price: 1667, number: '208', asi_item_id: 189 },
  { category: 'entrees', name: 'Salade langouste', price: 1866, number: '209', asi_item_id: 188 },
  { category: 'entrees', name: 'Salade de pâtes', price: 2275, number: '210', asi_item_id: 192 },
  { category: 'entrees', name: 'Salade mixte', price: 420, number: '211', asi_item_id: 514 },
  { category: 'entrees', name: 'Brochette de saucisse', price: 1000, number: '212', asi_item_id: 197 },

  // —— Spécialités ——
  { category: 'specialites', name: 'Tartare de poisson', price: 1750, number: '305', asi_item_id: 224, sides: false },
  { category: 'specialites', name: 'Riz aux fruits de mer', price: 2125, number: '306', asi_item_id: 222 },
  { category: 'specialites', name: 'Écrevisse aux agrumes', price: 2000, number: '307', asi_item_id: 221 },
  { category: 'specialites', name: 'Saumon roll', price: 1200, number: '308', asi_item_id: 451, sides: false },
  { category: 'specialites', name: 'Rumbo roll', price: 2000, number: '309', asi_item_id: 453, sides: false },

  // —— Nems (nouvelle cat.) ——
  {
    category: 'nems',
    createCategory: { key: 'nems', name: 'Nems', outlet: 'restaurant', priority: 95 },
    name: 'Nem cabri', price: 1300, number: '320', asi_item_id: 6890, sides: false,
  },
  { category: 'nems', name: 'Nem crevette', price: 1560, number: '321', asi_item_id: 6891, sides: false },
  { category: 'nems', name: 'Nem porc', price: 1300, number: '322', asi_item_id: 6889, sides: false },

  // —— Sushi (nouvelle cat.) ——
  {
    category: 'sushi',
    createCategory: { key: 'sushi', name: 'Sushi', outlet: 'restaurant', priority: 96 },
    name: 'Sushi crevette', price: 1300, number: '330', asi_item_id: 6888, sides: false,
  },
  { category: 'sushi', name: 'Sushi végétarien', price: 1170, number: '331', asi_item_id: 6892, sides: false },

  // —— Pâtes ——
  { category: 'pates', name: 'Spaghetti bolognaise', price: 1333, number: '405', asi_item_id: 242 },
  { category: 'pates', name: 'Spaghetti natures', price: 1067, number: '406', asi_item_id: 244 },
  { category: 'pates', name: 'Spaghetti végétariens', price: 1200, number: '407', asi_item_id: 243 },
  { category: 'pates', name: 'Penne au calamar', price: 2785, number: '408', asi_item_id: 135 },
  { category: 'pates', name: 'Fetuccini calamari', price: 1915, number: '409', asi_item_id: 241 },

  // —— Bœuf ——
  { category: 'boeuf', name: 'Filet de bœuf au gingembre', price: 1866, number: '505', asi_item_id: 238 },

  // —— Poulet ——
  { category: 'poulet', name: 'Poulet au curry', price: 2000, number: '706', asi_item_id: 230 },
  { category: 'poulet', name: 'Poulet dijonnaise', price: 1140, number: '707', asi_item_id: 571 },
  { category: 'poulet', name: 'Poulet djon-djon', price: 1600, number: '708', asi_item_id: 232 },
  { category: 'poulet', name: 'Blanc de poulet', price: 1600, number: '709', asi_item_id: 234 },
  { category: 'poulet', name: 'Poulet rôti', price: 5980, number: '710', asi_item_id: 2680 },
  { category: 'poulet', name: 'Poulet pays entier', price: 5900, number: '711', asi_item_id: 6900 },

  // —— Crustacés ——
  { category: 'crustaces', name: 'Écrevisses sautées', price: 3473, number: '1009', asi_item_id: 218 },
  { category: 'crustaces', name: 'Écrevisses panées', price: 2433, number: '1010', asi_item_id: 219 },
  { category: 'crustaces', name: "Brochette d'écrevisses", price: 1200, number: '1011', asi_item_id: 220 },
  { category: 'crustaces', name: 'Langouste panée', price: 1615, number: '1012', asi_item_id: 211 },
  { category: 'crustaces', name: 'Écrevisse tempura', price: 1170, number: '1013', asi_item_id: 6728 },

  // —— Léger ——
  { category: 'leger', name: 'Club sandwich', price: 1000, number: '1108', asi_item_id: 250 },
  { category: 'leger', name: 'Sandwich jambon fromage', price: 900, number: '1109', asi_item_id: 249 },
  { category: 'leger', name: 'Sandwich poulet', price: 890, number: '1110', asi_item_id: 248 },
  { category: 'leger', name: 'Sandwich aux œufs', price: 250, number: '1111', asi_item_id: 251 },
  { category: 'leger', name: 'Burger cabri', price: 950, number: '1112', asi_item_id: 649 },
  { category: 'leger', name: 'Burger lambi', price: 950, number: '1113', asi_item_id: 648 },
  { category: 'leger', name: 'Soupe de légumes du jour', price: 900, number: '1114', asi_item_id: 245 },

  // —— Desserts ——
  { category: 'desserts', name: 'Sorbet de fruits', price: 446, number: '1305', asi_item_id: 259 },
  { category: 'desserts', name: 'Tarte maison', price: 482, number: '1306', asi_item_id: 257 },
  { category: 'desserts', name: "Gâteau d'anniversaire", price: 380, number: '1307', asi_item_id: 433 },

  // —— Enfant (nouvelle cat.) ——
  {
    category: 'enfant',
    createCategory: { key: 'enfant', name: 'Menu enfant', outlet: 'restaurant', priority: 115 },
    name: '½ Spaghetti bolognaise', price: 760, number: '1151', asi_item_id: 1664,
  },
  { category: 'enfant', name: '½ Spaghetti saucisse', price: 700, number: '1152', asi_item_id: 1666 },
  { category: 'enfant', name: 'Poulet sauce créole / riz', price: 1000, number: '1153', asi_item_id: 1667 },
  { category: 'enfant', name: 'Saucisse avec frites ou riz', price: 650, number: '1154', asi_item_id: 1668 },

  // —— Weekend apéritifs déjà proches : aile poulet appetizer ——
  { category: 'weekend_aperitifs', name: 'Aile de poulet', price: 1300, number: '1407', asi_item_id: 6729 },
];

/** Price alignments: number → ASI price (skip false friends / package breakfast / plates vs sides). */
const PRICE_FIXES = [
  { number: '1634', price: 951, asi_item_id: 622 }, // Vodka Soda Absolut
  { number: '1635', price: 928, asi_item_id: 623 }, // Vodka Soda Grey Goose
  { number: '1636', price: 928, asi_item_id: 621 }, // Vodka Soda Stoli
  { number: '1637', price: 725, asi_item_id: 619 }, // Vodka Sour Absolut
  { number: '1638', price: 1261, asi_item_id: 618 }, // Vodka Sour Grey Goose
  { number: '1622', price: 1300, asi_item_id: 6896 }, // Mojito Perrier
  { number: '1617', price: 1419, asi_item_id: 574 }, // Gin Tonic Gordon
  { number: '1613', price: 600, asi_item_id: 58 }, // Gin Sour Beefeater
  { number: '1873', price: 120, asi_item_id: 14 }, // Gatorade (BARRESTO; BAR=0)
  { number: '3001', price: 500, asi_item_id: 393 }, // Plage adulte (= ASI)
  { number: '3002', price: 250, asi_item_id: 392 }, // Plage enfant (POSR 250)
  { number: '3004', price: 156, asi_item_id: 436 }, // Serviettes
  { number: '1854', price: 300, asi_item_id: 475 }, // Jus cranberry ASI
  { number: '1626', price: 1000 }, // Piña Colada tile = cheapest variant
];
// Plage (3003 / ASI 523) retired — far less used than Plage adulte.

const data = JSON.parse(fs.readFileSync(MENU, 'utf8'));
const byKey = new Map(data.categories.map((c) => [c.key, c]));
const usedNumbers = new Set();
for (const c of data.categories) {
  for (const it of c.items || []) {
    if (it.number) usedNumbers.add(String(it.number));
    for (const v of it.variants || []) if (v.from) usedNumbers.add(String(v.from));
  }
  for (const it of c.side_only || []) if (it.number) usedNumbers.add(String(it.number));
}

let added = 0;
let catsCreated = 0;
const insertAfter = (key, cat) => {
  const i = data.categories.findIndex((c) => c.key === key);
  if (i < 0) data.categories.push(cat);
  else data.categories.splice(i + 1, 0, cat);
};

for (const row of ADD) {
  if (usedNumbers.has(String(row.number))) {
    console.error(`skip duplicate number ${row.number} (${row.name})`);
    continue;
  }
  let cat = byKey.get(row.category);
  if (!cat && row.createCategory) {
    cat = { ...row.createCategory, items: [] };
    // Place new cats near peers
    if (row.category === 'cafe_the') insertAfter('energy_sport', cat);
    else if (row.category === 'nems') insertAfter('specialites', cat);
    else if (row.category === 'sushi') insertAfter('nems', cat);
    else if (row.category === 'enfant') insertAfter('leger', cat);
    else data.categories.push(cat);
    byKey.set(row.category, cat);
    catsCreated += 1;
  }
  if (!cat) throw new Error(`Unknown category ${row.category} for ${row.name}`);

  const item = {
    name: row.name,
    price: row.price,
    number: String(row.number),
  };
  if (row.asi_item_id != null) item.asi_item_id = row.asi_item_id;
  if (row.sides === false) item.sides = false;
  if (row.variants) item.variants = row.variants;

  cat.items.push(item);
  usedNumbers.add(String(row.number));
  for (const v of row.variants || []) if (v.from) usedNumbers.add(String(v.from));
  added += 1;
}

let priced = 0;
for (const fix of PRICE_FIXES) {
  for (const c of data.categories) {
    for (const it of c.items || []) {
      if (String(it.number) !== String(fix.number)) continue;
      if (Number(it.price) !== Number(fix.price)) {
        it.price = fix.price;
        priced += 1;
      }
      if (fix.asi_item_id != null && it.asi_item_id == null) it.asi_item_id = fix.asi_item_id;
      // Align single-price variants that mirror the dish
      if (it.variants?.length === 1 && it.variants[0].from === it.number) {
        it.variants[0].price = fix.price;
      }
    }
  }
}

fs.writeFileSync(MENU, JSON.stringify(data, null, 2) + '\n');
console.log(`OK: +${added} plats, +${catsCreated} catégories, ${priced} prix alignés → ${MENU}`);
