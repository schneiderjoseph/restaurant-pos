'use strict';

const WS = require('ws');
const { Surreal, StringRecordId } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') {
  global.WebSocket = WS;
}

async function connectSurreal(cfg) {
  const client = new Surreal();
  await client.connect(cfg.url, {
    namespace: cfg.ns,
    database: cfg.db,
    authentication: {
      username: cfg.user,
      password: cfg.pass,
    },
  });
  return client;
}

function recordIdString(id) {
  if (id == null) return '';
  if (typeof id === 'string') return id;
  if (typeof id === 'object') {
    if (typeof id.toString === 'function') {
      const s = id.toString();
      if (s && s !== '[object Object]') return s;
    }
    if (id.tb && id.id != null) return `${id.tb}:${id.id}`;
  }
  return String(id);
}

function asRecord(id) {
  const s = recordIdString(id);
  if (!s) throw new Error('Empty record id');
  return new StringRecordId(s);
}

function isRetryableConflict(err) {
  const msg = String(err?.message || err || '');
  return /transaction conflict|write conflict|can be retried/i.test(msg);
}

async function queryRows(db, sql, vars = {}, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await db.query(sql, vars);
      const first = Array.isArray(result) ? result[0] : result;
      return Array.isArray(first) ? first : first != null ? [first] : [];
    } catch (err) {
      lastErr = err;
      if (!isRetryableConflict(err) || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 40 * (i + 1) * (i + 1)));
    }
  }
  throw lastErr;
}

module.exports = {
  connectSurreal,
  recordIdString,
  asRecord,
  queryRows,
};
