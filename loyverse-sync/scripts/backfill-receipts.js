'use strict';

/**
 * Backfill Loyverse receipts into loyverse_mirror (worktree / loyverse DB only).
 * Usage: node scripts/backfill-receipts.js [--project]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { config } = require('../src/config');
const { connectSurreal } = require('../src/surreal');
const { backfillReceipts } = require('../src/receipts-backfill');

async function main() {
  if (config.surreal.ns === 'posr' && config.surreal.db === 'posr') {
    throw new Error('Refusing backfill on posr/posr');
  }
  config.syncReceipts = true;
  const project = process.argv.includes('--project');
  const db = await connectSurreal(config.surreal);
  try {
    const out = await backfillReceipts(db, config, { project });
    console.log('[backfill-receipts]', out);
  } finally {
    if (typeof db.close === 'function') await db.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
