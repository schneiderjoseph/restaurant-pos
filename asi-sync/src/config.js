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
 * IMPORTANT (restaurant-pos native):
 * - Point SURREAL_URL at THIS repo's Surreal only (never a shared ASI fork DB).
 * - ASI_FD_SYNC defaults OFF so guests are not polled until explicitly enabled.
 */
const config = {
  asi: {
    server: process.env.ASI_SQL_SERVER || '192.168.0.190',
    port: Number(process.env.ASI_SQL_PORT || 56479),
    database: process.env.ASI_SQL_DATABASE || 'ASIPOS600',
    user: required('ASI_SQL_USER'),
    password: required('ASI_SQL_PASSWORD'),
    encrypt: bool('ASI_SQL_ENCRYPT', false),
    trustCert: bool('ASI_SQL_TRUST_CERT', true),
    posId: process.env.ASI_POS_ID ? Number(process.env.ASI_POS_ID) : null,
    priceToHtg: bool('ASI_PRICE_TO_HTG', false),
  },
  /** FrontDesk guests — same host, DB ASIFD600. Off by default in this repo. */
  fd: {
    enabled: bool('ASI_FD_SYNC', false),
    server: optional('ASI_FD_SQL_SERVER', process.env.ASI_SQL_SERVER || '192.168.0.190'),
    port: Number(process.env.ASI_FD_SQL_PORT || process.env.ASI_SQL_PORT || 56479),
    database: optional('ASI_FD_SQL_DATABASE', 'ASIFD600'),
    user: optional('ASI_FD_SQL_USER', ''),
    password: optional('ASI_FD_SQL_PASSWORD', ''),
    encrypt: bool('ASI_FD_SQL_ENCRYPT', bool('ASI_SQL_ENCRYPT', false)),
    trustCert: bool('ASI_FD_SQL_TRUST_CERT', bool('ASI_SQL_TRUST_CERT', true)),
  },
  surreal: {
    url: process.env.SURREAL_URL || 'ws://127.0.0.1:8002/rpc',
    ns: process.env.SURREAL_NS || 'posr',
    db: process.env.SURREAL_DB || 'posr',
    user: required('SURREAL_USER'),
    pass: required('SURREAL_PASS'),
  },
  syncMenu: bool('ASI_MENU_SYNC', false),
  intervalMs: Number(process.env.ASI_SYNC_INTERVAL_MS || 30000),
  once: bool('ASI_SYNC_ONCE', false) || process.argv.includes('--once'),
};

if (config.fd.enabled) {
  if (!config.fd.user) throw new Error('Missing ASI_FD_SQL_USER (required when ASI_FD_SYNC=1)');
  if (!config.fd.password) throw new Error('Missing ASI_FD_SQL_PASSWORD (required when ASI_FD_SYNC=1)');
}

module.exports = { config };
