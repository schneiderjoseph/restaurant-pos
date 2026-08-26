'use strict';

const { config } = require('./config');
const { connectSurreal } = require('./surreal');
const { fetchLoyverseCatalog } = require('./loyverse-query');
const { upsertCatalog } = require('./posr-upsert');
const {
  upsertCustomers,
  upsertPaymentTypes,
  upsertDiscounts,
  upsertModifiers,
  upsertStoreMeta,
  upsertEmployeeMeta,
} = require('./extras-upsert');

function log(msg, extra) {
  const ts = new Date().toISOString();
  if (extra !== undefined) console.log(`[${ts}] ${msg}`, extra);
  else console.log(`[${ts}] ${msg}`);
}

async function syncAll(db) {
  log('Fetching Loyverse (full pull)…', {
    base: config.loyverse.baseUrl,
    storeId: config.loyverse.storeId || '(auto)',
    target: `${config.surreal.ns}/${config.surreal.db}`,
  });
  const catalog = await fetchLoyverseCatalog(config.loyverse);
  log('Loyverse payload loaded', {
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
  });

  const out = {};

  if (config.syncMenu) {
    out.menu = await upsertCatalog(db, catalog);
    log('Menu sync complete', out.menu);
  } else {
    log('Menu sync skipped (LOYVERSE_MENU_SYNC=0)');
  }

  if (config.syncModifiers) {
    out.modifiers = await upsertModifiers(db, catalog.modifiers);
    log('Modifiers sync complete', {
      groups: out.modifiers.groups,
      options: out.modifiers.options,
    });
  }

  if (config.syncCustomers) {
    out.customers = await upsertCustomers(db, catalog.customers);
    log('Customers sync complete', out.customers);
  }

  if (config.syncPaymentTypes) {
    out.payments = await upsertPaymentTypes(db, catalog.paymentTypes);
    log('Payment types sync complete', out.payments);
  }

  if (config.syncDiscounts) {
    out.discounts = await upsertDiscounts(db, catalog.discounts);
    log('Discounts sync complete', out.discounts);
  }

  out.stores = await upsertStoreMeta(db, catalog.stores, catalog.storeId);
  out.employees = await upsertEmployeeMeta(db, catalog.employees);
  log('Store/employee meta saved', {
    stores: out.stores.stores,
    employees: out.employees.employees,
  });

  return out;
}

async function runOnce() {
  log('Connecting Surreal…', {
    url: config.surreal.url,
    ns: config.surreal.ns,
    db: config.surreal.db,
  });
  if (config.surreal.ns === 'posr' && config.surreal.db === 'posr') {
    throw new Error(
      'Refusing to sync into posr/posr — set SURREAL_NS=loyverse SURREAL_DB=loyverse (isolated DB).',
    );
  }
  const db = await connectSurreal(config.surreal);
  try {
    const out = await syncAll(db);
    log('Sync complete', {
      menuItems: out.menu?.menuItems,
      customers: out.customers?.total,
      payments: out.payments?.upserted,
      discounts: out.discounts?.upserted,
    });
    return out;
  } finally {
    if (typeof db.close === 'function') {
      await db.close().catch(() => {});
    }
  }
}

async function main() {
  if (config.once) {
    await runOnce();
    return;
  }

  log(`Starting Loyverse→POSR poll every ${config.intervalMs}ms`, {
    target: `${config.surreal.ns}/${config.surreal.db}`,
    menu: config.syncMenu,
    customers: config.syncCustomers,
    payments: config.syncPaymentTypes,
    discounts: config.syncDiscounts,
    modifiers: config.syncModifiers,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
