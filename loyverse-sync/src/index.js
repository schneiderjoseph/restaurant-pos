'use strict';

const crypto = require('crypto');
const { config } = require('./config');
const { connectSurreal } = require('./surreal');
const { mirrorCatalog, mirrorInventory, isResourceEnabled } = require('./fetch-all');
const { loadCatalogFromMirror, fetchLoyverseCatalog } = require('./loyverse-query');
const { upsertCatalog } = require('./posr-upsert');
const {
  upsertCustomers,
  upsertPaymentTypes,
  upsertDiscounts,
  upsertModifiersToPosr,
  upsertStoreMeta,
  upsertEmployeeMeta,
  linkItemModifierGroups,
} = require('./extras-upsert');
const { syncReceiptsIncremental } = require('./receipts-backfill');
const { getResource } = require('./resources');

function log(msg, extra) {
  const ts = new Date().toISOString();
  if (extra !== undefined) console.log(`[${ts}] ${msg}`, extra);
  else console.log(`[${ts}] ${msg}`);
}

function assertSafeTarget(cfg) {
  if (cfg.surreal.ns === 'posr' && cfg.surreal.db === 'posr') {
    throw new Error(
      'Refusing to sync into posr/posr — set LOYVERSE_SURREAL_NS/DB=loyverse (isolated DB).',
    );
  }
}

/**
 * @param {import('surrealdb').Surreal} db
 */
async function loadCatalog(db) {
  if (config.mirrorSync) {
    return loadCatalogFromMirror(db, config.loyverse.storeId);
  }
  return fetchLoyverseCatalog(config.loyverse);
}

/**
 * @param {import('surrealdb').Surreal} db
 */
async function mirrorPhase(db) {
  if (!config.mirrorSync) {
    log('Mirror sync disabled (LOYVERSE_MIRROR_SYNC=0)');
    return null;
  }

  log('Mirror pull → loyverse_mirror…', {
    target: `${config.surreal.ns}/${config.surreal.db}`,
  });
  const mirrorStats = await mirrorCatalog(db, config);

  if (isResourceEnabled(getResource('inventory'), config)) {
    try {
      mirrorStats.inventory = await mirrorInventory(db, config);
    } catch (err) {
      console.warn('[mirror] inventory failed:', err?.message || err);
    }
  }

  log('Mirror pull complete', mirrorStats);
  return mirrorStats;
}

/**
 * @param {import('surrealdb').Surreal} db
 */
async function projectPhase(db, catalog) {
  const out = {};

  if (config.syncMenu) {
    out.menu = await upsertCatalog(db, catalog);
    log('Menu projection complete', out.menu);
  } else {
    log('Menu projection skipped (LOYVERSE_MENU_SYNC=0)');
  }

  if (config.syncModifiers) {
    out.modifiers = await upsertModifiersToPosr(db, catalog.modifiers);
    out.modifierLinks = await linkItemModifierGroups(db, catalog.variants, out.modifiers.groupMap);
    log('Modifiers projection complete', {
      groups: out.modifiers.groups,
      options: out.modifiers.options,
      links: out.modifierLinks.linked,
    });
  }

  if (config.syncCustomers) {
    out.customers = await upsertCustomers(db, catalog.customers);
    log('Customers projection complete', out.customers);
  }

  if (config.syncPaymentTypes) {
    out.payments = await upsertPaymentTypes(db, catalog.paymentTypes);
    log('Payment types projection complete', out.payments);
  }

  if (config.syncDiscounts) {
    out.discounts = await upsertDiscounts(db, catalog.discounts);
    log('Discounts projection complete', out.discounts);
  }

  out.stores = await upsertStoreMeta(db, catalog.stores, catalog.storeId);
  out.employees = await upsertEmployeeMeta(db, catalog.employees);
  log('Store/employee meta saved', {
    stores: out.stores.stores,
    employees: out.employees.employees,
  });

  return out;
}

async function syncAll(db) {
  await mirrorPhase(db);
  const catalog = await loadCatalog(db);
  log('Catalog loaded for projection', {
    categories: catalog.categories.length,
    variants: catalog.variants.length,
    taxes: catalog.taxes.length,
    modifiers: catalog.modifiers.length,
    customers: catalog.customers.length,
    paymentTypes: catalog.paymentTypes.length,
    discounts: catalog.discounts.length,
    employees: catalog.employees.length,
    stores: catalog.stores.length,
    storeId: catalog.storeId,
    source: config.mirrorSync ? 'mirror' : 'api',
  });

  const out = await projectPhase(db, catalog);

  if (config.syncReceipts && config.mirrorSync) {
    try {
      out.receipts = await syncReceiptsIncremental(db, config);
      log('Receipts incremental sync', out.receipts);
    } catch (err) {
      console.warn('[receipts] incremental failed:', err?.message || err);
    }
  }

  return out;
}

async function runOnce() {
  assertSafeTarget(config);
  log('Connecting Surreal…', {
    url: config.surreal.url,
    ns: config.surreal.ns,
    db: config.surreal.db,
  });
  const db = await connectSurreal(config.surreal);
  try {
    const out = await syncAll(db);
    log('Sync complete', {
      menuItems: out.menu?.menuItems,
      customers: out.customers?.total,
      payments: out.payments?.upserted,
      discounts: out.discounts?.upserted,
      mirror: config.mirrorSync,
    });
    return out;
  } finally {
    if (typeof db.close === 'function') {
      await db.close().catch(() => {});
    }
  }
}

async function main() {
  const resourceArg = process.argv.find((a) => a.startsWith('--resource='));
  const onlyResource = resourceArg ? resourceArg.split('=')[1] : null;

  if (onlyResource) {
    assertSafeTarget(config);
    const db = await connectSurreal(config.surreal);
    try {
      if (onlyResource === 'receipts') {
        const { backfillReceipts } = require('./receipts-backfill');
        const out = await backfillReceipts(db, config);
        log('Receipt backfill done', out);
        return;
      }
      if (onlyResource === 'shifts') {
        const { backfillShifts } = require('./shifts-backfill');
        const out = await backfillShifts(db, config);
        log('Shift backfill done', out);
        return;
      }
      await mirrorCatalog(db, config, { resources: [onlyResource] });
      log(`Mirror resource ${onlyResource} complete`);
    } finally {
      if (typeof db.close === 'function') await db.close().catch(() => {});
    }
    return;
  }

  if (config.once) {
    await runOnce();
    return;
  }

  log(`Starting Loyverse sync every ${config.intervalMs}ms`, {
    target: `${config.surreal.ns}/${config.surreal.db}`,
    mirror: config.mirrorSync,
    menu: config.syncMenu,
    customers: config.syncCustomers,
    payments: config.syncPaymentTypes,
    discounts: config.syncDiscounts,
    modifiers: config.syncModifiers,
    receipts: config.syncReceipts,
  });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runOnce();
    } catch (err) {
      console.error(`[${new Date().toISOString()}] Sync failed:`, err?.message || err);
    }
    await new Promise((r) => setTimeout(r, config.intervalMs));
  }
}

module.exports = { runOnce, syncAll, mirrorPhase, projectPhase };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
