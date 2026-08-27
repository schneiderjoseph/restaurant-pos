'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function required(name) {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') {
    throw new Error(`Missing required env ${name}`);
  }
  return String(v).trim();
}

function optional(name, fallback = '') {
  const v = process.env[name];
  if (v === undefined || String(v).trim() === '') return fallback;
  return String(v).trim();
}

function bool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

/**
 * IMPORTANT:
 * - Default Surreal target is the ISOLATED NS/DB loyverse/loyverse — never posr/posr.
 * - Token stays server-side; never put LOYVERSE_ACCESS_TOKEN in Vite env.
 */
const config = {
  loyverse: {
    token: required('LOYVERSE_ACCESS_TOKEN'),
    baseUrl: optional('LOYVERSE_API_BASE', 'https://api.loyverse.com/v1.0').replace(/\/$/, ''),
    storeId: optional('LOYVERSE_STORE_ID', '') || null,
  },
  surreal: {
    url: process.env.SURREAL_URL || 'ws://127.0.0.1:8001/rpc',
    ns: process.env.LOYVERSE_SURREAL_NS || 'loyverse',
    db: process.env.LOYVERSE_SURREAL_DB || 'loyverse',
    user: required('SURREAL_USER'),
    pass: required('SURREAL_PASS'),
  },
  mirrorSync: bool('LOYVERSE_MIRROR_SYNC', true),
  syncMenu: bool('LOYVERSE_MENU_SYNC', true),
  syncCustomers: bool('LOYVERSE_CUSTOMER_SYNC', true),
  syncPaymentTypes: bool('LOYVERSE_PAYMENT_SYNC', true),
  syncDiscounts: bool('LOYVERSE_DISCOUNT_SYNC', true),
  syncModifiers: bool('LOYVERSE_MODIFIER_SYNC', true),
  syncInventory: bool('LOYVERSE_SYNC_INVENTORY', false),
  syncReceipts: bool('LOYVERSE_SYNC_RECEIPTS', false),
  syncShifts: bool('LOYVERSE_SYNC_SHIFTS', false),
  syncSuppliers: bool('LOYVERSE_SYNC_SUPPLIERS', true),
  syncPosDevices: bool('LOYVERSE_SYNC_POS_DEVICES', true),
  syncMerchant: bool('LOYVERSE_SYNC_MERCHANT', true),
  receiptsBackfill: bool('LOYVERSE_RECEIPTS_BACKFILL', false),
  projectReceipts: bool('LOYVERSE_PROJECT_RECEIPTS', false),
  receiptProjectBatch: Number(process.env.LOYVERSE_RECEIPT_PROJECT_BATCH || 500),
  rateLimitRpm: Number(process.env.LOYVERSE_RATE_LIMIT_RPM || 50),
  webhookPort: Number(process.env.LOYVERSE_WEBHOOK_PORT || 3150),
  webhookSecret: optional('LOYVERSE_WEBHOOK_SECRET', ''),
  intervalMs: Number(process.env.LOYVERSE_SYNC_INTERVAL_MS || 60000),
  once: bool('LOYVERSE_SYNC_ONCE', false) || process.argv.includes('--once'),
};

if (config.surreal.ns === 'posr' && config.surreal.db === 'posr') {
  console.warn(
    '[loyverse-sync] WARNING: SURREAL_NS/DB is posr/posr — prefer loyverse/loyverse so ASI/native stays untouched.',
  );
}

module.exports = { config };
