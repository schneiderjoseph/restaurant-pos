'use strict';

/**
 * Run from repo root:
 *   node --test shared/user-file-logger.test.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'posr-user-logs-'));
process.env.USER_LOG_DIR = tmpRoot;

const {
  appendUserLog,
  recordDeviceConnection,
  sanitizeLogin,
  localDateStamp,
  filePathFor,
  lastDevicesPath,
  buildLine,
  UNKNOWN_USER,
} = require('./user-file-logger');

before(() => {
  process.env.USER_LOG_DIR = tmpRoot;
});

after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('sanitizeLogin strips unsafe chars and falls back to _unknown', () => {
  assert.equal(sanitizeLogin('marie'), 'marie');
  assert.equal(sanitizeLogin('Marie/Admin'), 'Marie_Admin');
  assert.equal(sanitizeLogin('../etc'), '.._etc');
  assert.equal(sanitizeLogin(''), UNKNOWN_USER);
  assert.equal(sanitizeLogin(null), UNKNOWN_USER);
});

test('localDateStamp is YYYY-MM-DD', () => {
  assert.match(localDateStamp(new Date('2026-10-09T15:00:00')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(localDateStamp(new Date(2026, 9, 9)), '2026-10-09');
});

test('filePathFor nests login then date', () => {
  const p = filePathFor('marie', new Date(2026, 9, 9));
  assert.equal(path.basename(p), '2026-10-09.log');
  assert.equal(path.basename(path.dirname(p)), 'marie');
  assert.ok(p.startsWith(tmpRoot));
});

test('buildLine is single-line and masks secrets', () => {
  const line = buildLine({
    level: 'ERROR',
    service: 'api',
    action: 'fail',
    message: 'boom',
    meta: { password: 'secret', order: 'order:1' },
  });
  assert.equal(line.endsWith('\n'), true);
  assert.equal(line.includes('\n', 0) && line.indexOf('\n') === line.length - 1, true);
  assert.match(line, /ERROR api fail boom/);
  assert.match(line, /password=\*\*\*/);
  assert.match(line, /order=order:1/);
  assert.doesNotMatch(line, /secret/);
});

test('appendUserLog writes a file asynchronously', async () => {
  appendUserLog({
    user: 'cashier1',
    level: 'ACTION',
    service: 'tracking',
    action: 'orders.complete',
    meta: { order: 'order:abc' },
  });

  const expected = filePathFor('cashier1');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(fs.existsSync(expected), true);
  const body = fs.readFileSync(expected, 'utf8');
  assert.match(body, /ACTION tracking orders\.complete/);
  assert.match(body, /order=order:abc/);
});

test('recordDeviceConnection keeps last devices with IP', () => {
  recordDeviceConnection({
    user: 'marie',
    ip: '192.168.1.40',
    deviceId: 'tablet-AAAA1111',
    userAgent: 'Mozilla/5.0',
    ok: true,
  });
  recordDeviceConnection({
    user: 'marie',
    ip: '10.0.0.5',
    deviceId: 'tablet-BBBB2222',
    userAgent: 'POS Tablet',
    ok: true,
  });
  // Same device, new IP — updates in place, stays first
  recordDeviceConnection({
    user: 'marie',
    ip: '10.0.0.9',
    deviceId: 'tablet-BBBB2222',
    ok: true,
  });

  const file = lastDevicesPath('marie');
  assert.equal(fs.existsSync(file), true);
  const devices = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(devices.length, 2);
  assert.equal(devices[0].deviceId, 'tablet-BBBB2222');
  assert.equal(devices[0].ip, '10.0.0.9');
  assert.equal(devices[1].deviceId, 'tablet-AAAA1111');
  assert.equal(devices[1].ip, '192.168.1.40');
});
