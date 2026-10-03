'use strict';

/**
 * One active session per user: a login on another device displaces the previous one.
 *
 * Run from the gateway directory:
 *   node --test src/active-session-store.test.js
 */

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { WebSocket } = require('ws');

const store = require('./active-session-store');
const { closeSessionSockets, SESSION_REPLACED_CLOSE_CODE, _trackSocketForTests } = require('./ws-relay');

const NOW = Date.parse('2026-10-03T12:00:00Z');
const LATER = NOW + 12 * 3600 * 1000;

beforeEach(() => store._resetForTests());

test('first login displaces nothing', async () => {
  assert.deepEqual(await store.claim('user:1', { jti: 'a', deviceId: 'tablet-A', expiresAt: LATER }, NOW), []);
});

test('a login on another device displaces the live session', async () => {
  await store.claim('user:1', { jti: 'a', deviceId: 'tablet-A', expiresAt: LATER }, NOW);
  const displaced = await store.claim('user:1', { jti: 'b', deviceId: 'tablet-B', expiresAt: LATER }, NOW);
  assert.deepEqual(displaced, [{ jti: 'a', expiresAt: LATER }]);
});

test('every session of the other device goes, including older tokens kept after an unlock', async () => {
  await store.claim('user:1', { jti: 'a1', deviceId: 'tablet-A', expiresAt: LATER }, NOW);
  assert.deepEqual(await store.claim('user:1', { jti: 'a2', deviceId: 'tablet-A', expiresAt: LATER }, NOW), []);
  const displaced = await store.claim('user:1', { jti: 'b', deviceId: 'tablet-B', expiresAt: LATER }, NOW);
  assert.deepEqual(displaced.map((s) => s.jti).sort(), ['a1', 'a2']);
  const back = await store.claim('user:1', { jti: 'a3', deviceId: 'tablet-A', expiresAt: LATER }, NOW);
  assert.deepEqual(back.map((s) => s.jti), ['b']);
});

test('the same device signing in again (unlock, second tab) displaces nothing', async () => {
  await store.claim('user:1', { jti: 'a', deviceId: 'tablet-A', expiresAt: LATER }, NOW);
  assert.deepEqual(await store.claim('user:1', { jti: 'b', deviceId: 'tablet-A', expiresAt: LATER }, NOW), []);
});

test('an expired session is not displaced', async () => {
  await store.claim('user:1', { jti: 'a', deviceId: 'tablet-A', expiresAt: NOW - 1 }, NOW);
  assert.deepEqual(await store.claim('user:1', { jti: 'b', deviceId: 'tablet-B', expiresAt: LATER }, NOW), []);
});

test('a session without a device id is treated as another device', async () => {
  await store.claim('user:1', { jti: 'a', deviceId: null, expiresAt: LATER }, NOW);
  const displaced = await store.claim('user:1', { jti: 'b', deviceId: 'tablet-B', expiresAt: LATER }, NOW);
  assert.deepEqual(displaced.map((s) => s.jti), ['a']);
});

test('users do not displace each other', async () => {
  await store.claim('user:1', { jti: 'a', deviceId: 'tablet-A', expiresAt: LATER }, NOW);
  assert.deepEqual(await store.claim('user:2', { jti: 'b', deviceId: 'tablet-B', expiresAt: LATER }, NOW), []);
});

test('previous sessions are read back from the database after a restart', async () => {
  const writes = [];
  store.setSurrealClient({
    query: async (sql, vars) => {
      if (sql.startsWith('SELECT')) {
        return [[{ jti: 'a', device_id: 'tablet-A', expires_at: new Date(LATER).toISOString() }]];
      }
      writes.push({ sql: sql.split(' ')[0], vars });
      return [[]];
    },
  });
  const displaced = await store.claim('user:1', { jti: 'b', deviceId: 'tablet-B', expiresAt: LATER }, NOW);
  assert.deepEqual(displaced.map((s) => s.jti), ['a']);
  assert.deepEqual(writes.map((w) => w.sql), ['DELETE', 'CREATE']);
  assert.deepEqual(writes[0].vars.jtis, ['a']);
});

test('closing a session drops only its own sockets, with the replaced code', () => {
  const socket = () => {
    const ws = new EventEmitter();
    ws.readyState = WebSocket.OPEN;
    ws.closed = null;
    ws.close = (code, reason) => {
      ws.closed = { code, reason };
      ws.emit('close');
    };
    return ws;
  };
  const old1 = socket();
  const old2 = socket();
  const other = socket();
  _trackSocketForTests('jti-old', old1);
  _trackSocketForTests('jti-old', old2);
  _trackSocketForTests('jti-other', other);

  assert.equal(closeSessionSockets('jti-old'), 2);
  assert.deepEqual(old1.closed, { code: SESSION_REPLACED_CLOSE_CODE, reason: 'session_replaced' });
  assert.deepEqual(old2.closed, { code: SESSION_REPLACED_CLOSE_CODE, reason: 'session_replaced' });
  assert.equal(other.closed, null);
  assert.equal(closeSessionSockets('jti-old'), 0);
});
