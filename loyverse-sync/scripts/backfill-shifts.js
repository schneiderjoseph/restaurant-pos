'use strict';

/**
 * Backfill Loyverse shifts into loyverse_mirror.
 * Usage: node scripts/backfill-shifts.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { config } = require('../src/config');
const { connectSurreal } = require('../src/surreal');
const { backfillShifts } = require('../src/shifts-backfill');

async function main() {
  if (config.surreal.ns === 'posr' && config.surreal.db === 'posr') {
    throw new Error('Refusing backfill on posr/posr');
  }
  config.syncShifts = true;
  const db = await connectSurreal(config.surreal);
  try {
    const out = await backfillShifts(db, config);
    console.log('[backfill-shifts]', out);
  } finally {
    if (typeof db.close === 'function') await db.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
