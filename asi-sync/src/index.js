'use strict';

const { config } = require('./config');
const { fetchAsiCatalog } = require('./asi-query');
const { connectSurreal } = require('./surreal');
const { upsertCatalog } = require('./posr-upsert');
const { fetchInHouseGuests } = require('./fd-query');
const { upsertGuests } = require('./guest-upsert');
const { fetchAsiTables } = require('./table-query');
const { upsertTables } = require('./table-upsert');
const { fetchAsiRooms } = require('./room-query');
const { upsertRooms } = require('./room-upsert');

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

async function syncTables(db) {
  log('Fetching ASI dining tables…', {
    server: `${config.asi.server},${config.asi.port}`,
    database: config.asi.database,
  });
  const { tables } = await fetchAsiTables(config.asi);
  log('ASI dining tables loaded', { count: tables.length });
  const stats = await upsertTables(db, { tables });
  log('Table sync complete', stats);
  return stats;
}

async function syncRooms(db) {
  log('Fetching ASI hotel rooms…', {
    server: `${config.fd.server},${config.fd.port}`,
    database: config.fd.database,
  });
  const { rooms } = await fetchAsiRooms(config.fd);
  log('ASI hotel rooms loaded', { count: rooms.length });
  const stats = await upsertRooms(db, { rooms });
  log('Room sync complete', stats);
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
    if (config.syncTables) {
      out.tables = await syncTables(db);
    } else {
      log('Table sync skipped (ASI_TABLE_SYNC=0)');
    }
    if (config.syncRooms) {
      out.rooms = await syncRooms(db);
    } else {
      log('Room sync skipped (ASI_ROOM_SYNC=0)');
    }
    if (config.fd.enabled) {
      out.guests = await syncGuests(db);
    } else {
      log('Guest sync skipped (ASI_FD_SYNC=0)');
    }
    if (!config.syncMenu && !config.syncTables && !config.syncRooms && !config.fd.enabled) {
      log('Nothing to sync — enable ASI_MENU_SYNC, ASI_TABLE_SYNC, ASI_ROOM_SYNC and/or ASI_FD_SYNC in asi-sync/.env');
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
    tables: config.syncTables,
    rooms: config.syncRooms,
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
