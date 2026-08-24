'use strict';

const { config } = require('./config');
const { fetchAsiCatalog } = require('./asi-query');
const { connectSurreal } = require('./surreal');
const { upsertCatalog } = require('./posr-upsert');
const { fetchInHouseGuests } = require('./fd-query');
const { upsertGuests } = require('./guest-upsert');

function log(msg, extra) {
  const ts = new Date().toISOString();
  if (extra !== undefined) console.log(`[${ts}] ${msg}`, extra);
  else console.log(`[${ts}] ${msg}`);
}

async function syncMenu(db) {
  log('Fetching ASI catalog…', {
    server: `${config.asi.server},${config.asi.port}`,
    database: config.asi.database,
  });
  const catalog = await fetchAsiCatalog(config.asi);
  log('ASI catalog loaded', {
    groups: catalog.groups.length,
    activeItems: catalog.activeItems.length,
    inactiveIds: catalog.inactiveIds.length,
  });
  const stats = await upsertCatalog(db, catalog);
  log('Menu sync complete', stats);
  return stats;
}

async function syncGuests(db) {
  log('Fetching ASI FrontDesk in-house guests…', {
    server: `${config.fd.server},${config.fd.port}`,
    database: config.fd.database,
  });
  const { guests } = await fetchInHouseGuests(config.fd);
  log('ASI in-house guests loaded', { count: guests.length });
  const stats = await upsertGuests(db, guests);
  log('Guest sync complete', stats);
  return stats;
}

async function runOnce() {
  log('Connecting Surreal…', { url: config.surreal.url });
  const db = await connectSurreal(config.surreal);
  try {
    const out = {};
    if (config.syncMenu) {
      out.menu = await syncMenu(db);
    } else {
      log('Menu sync skipped (ASI_MENU_SYNC=0)');
    }
    if (config.fd.enabled) {
      out.guests = await syncGuests(db);
    } else {
      log('Guest sync skipped (ASI_FD_SYNC=0)');
    }
    if (!config.syncMenu && !config.fd.enabled) {
      log('Nothing to sync — enable ASI_MENU_SYNC and/or ASI_FD_SYNC in asi-sync/.env');
    }
    log('Sync complete', out);
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

  log(`Starting ASI→POSR poll every ${config.intervalMs}ms`, {
    menu: config.syncMenu,
    fd: config.fd.enabled,
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
