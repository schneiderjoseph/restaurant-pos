'use strict';

/**
 * Per-user daily file logs: logs/{login}/YYYY-MM-DD.log
 *
 * Best-effort append — never throws to callers. Never blocks the POS.
 * Set USER_LOG_DIR (Docker default: /logs). Otherwise defaults to <repo>/logs.
 */

const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const META_MAX = 500;
const UNKNOWN_USER = '_unknown';
const LAST_DEVICES_FILE = 'last-devices.json';
const LAST_DEVICES_MAX = 20;

const userContext = new AsyncLocalStorage();

const SECRET_KEY_RE =
  /password|secret|token|authorization|api[_-]?key|passkey|integrity_salt|client_secret/i;

function defaultLogDir() {
  if (process.env.USER_LOG_DIR) {
    return path.resolve(process.env.USER_LOG_DIR);
  }
  // shared/ → repo root → logs
  return path.resolve(__dirname, '..', 'logs');
}

function sanitizeLogin(user) {
  const raw = user == null ? '' : String(user).trim();
  if (!raw) return UNKNOWN_USER;
  const cleaned = raw.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
  return cleaned || UNKNOWN_USER;
}

function localDateStamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function truncate(text, max = META_MAX) {
  const s = String(text);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

function sanitizeMeta(meta) {
  if (meta == null) return undefined;
  if (typeof meta !== 'object') return truncate(meta);
  const out = Array.isArray(meta) ? [] : {};
  for (const [key, value] of Object.entries(meta)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = '***';
    } else if (value != null && typeof value === 'object') {
      out[key] = sanitizeMeta(value);
    } else if (typeof value === 'string') {
      out[key] = truncate(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function formatMetaKv(meta) {
  const clean = sanitizeMeta(meta);
  if (clean == null) return '';
  if (typeof clean !== 'object') return ` ${truncate(clean)}`;
  const parts = [];
  for (const [key, value] of Object.entries(clean)) {
    if (value == null) continue;
    const rendered =
      typeof value === 'object' ? truncate(JSON.stringify(value)) : truncate(String(value));
    const needsQuotes = /\s/.test(rendered);
    parts.push(needsQuotes ? `${key}="${rendered.replace(/"/g, '\\"')}"` : `${key}=${rendered}`);
  }
  return parts.length ? ` ${parts.join(' ')}` : '';
}

function resolveUser(explicit) {
  if (explicit != null && String(explicit).trim()) return explicit;
  const fromStore = userContext.getStore();
  if (fromStore != null && String(fromStore).trim()) return fromStore;
  return UNKNOWN_USER;
}

function buildLine({ level, service, action, message, meta }) {
  const ts = new Date().toISOString();
  const lvl = String(level || 'INFO').toUpperCase();
  const svc = service || '-';
  const act = action || '-';
  const msg = message ? ` ${truncate(message, 300)}` : '';
  return `${ts} ${lvl} ${svc} ${act}${msg}${formatMetaKv(meta)}\n`;
}

function userDir(user) {
  return path.join(defaultLogDir(), sanitizeLogin(user));
}

function filePathFor(user, date = new Date()) {
  return path.join(userDir(user), `${localDateStamp(date)}.log`);
}

function lastDevicesPath(user) {
  return path.join(userDir(user), LAST_DEVICES_FILE);
}

function deviceKey({ deviceId, ip }) {
  if (deviceId) return `device:${String(deviceId)}`;
  if (ip) return `ip:${String(ip)}`;
  return 'unknown';
}

/**
 * Update logs/{login}/last-devices.json and append a daily log line.
 * Best-effort — never throws.
 *
 * @param {object} entry
 * @param {string} [entry.user]
 * @param {string} [entry.ip]
 * @param {string} [entry.deviceId]
 * @param {string} [entry.userAgent]
 * @param {boolean} [entry.ok] — false for failed login attempts
 */
function recordDeviceConnection(entry = {}) {
  try {
    const user = resolveUser(entry.user);
    const now = new Date().toISOString();
    const ip = entry.ip ? String(entry.ip) : null;
    const deviceId = entry.deviceId ? String(entry.deviceId) : null;
    const userAgent = entry.userAgent
      ? truncate(String(entry.userAgent), 200)
      : null;
    const ok = entry.ok !== false;
    const key = deviceKey({ deviceId, ip });

    const dir = userDir(user);
    fs.mkdirSync(dir, { recursive: true });
    const file = lastDevicesPath(user);

    let devices = [];
    try {
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(parsed)) devices = parsed;
      }
    } catch {
      devices = [];
    }

    const next = {
      key,
      deviceId,
      ip,
      userAgent,
      lastSeen: now,
      lastOk: ok,
    };
    devices = [next, ...devices.filter((d) => d && d.key !== key)].slice(
      0,
      LAST_DEVICES_MAX
    );
    fs.writeFileSync(file, `${JSON.stringify(devices, null, 2)}\n`, 'utf8');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[user-file-logger] recordDeviceConnection failed:',
      err && err.message ? err.message : err
    );
  }
}

/**
 * Append one log line for a user. Fire-and-forget; never throws.
 *
 * @param {object} entry
 * @param {string} [entry.user] — login; falls back to AsyncLocalStorage / _unknown
 * @param {string} [entry.level] — INFO | ACTION | ERROR | WARN
 * @param {string} [entry.service] — gateway | tracking | api | payment | printing
 * @param {string} [entry.action]
 * @param {string} [entry.message]
 * @param {object} [entry.meta]
 */
function appendUserLog(entry = {}) {
  try {
    const user = resolveUser(entry.user);
    const line = buildLine(entry);
    const filePath = filePathFor(user);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFile(filePath, line, (err) => {
      if (err) {
        // eslint-disable-next-line no-console
        console.error('[user-file-logger] append failed:', err.message);
      }
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[user-file-logger] failed:', err && err.message ? err.message : err);
  }
}

/** Run fn with a default user login for nested appendUserLog calls. */
function runWithUser(user, fn) {
  return userContext.run(sanitizeLogin(user) === UNKNOWN_USER ? user : String(user), fn);
}

function setUserContext(user) {
  // Express-friendly: bind login for the rest of the sync continuation only.
  // Prefer runWithUser / passing user= explicitly for async work.
  return userContext.enterWith(user == null ? UNKNOWN_USER : String(user));
}

module.exports = {
  appendUserLog,
  recordDeviceConnection,
  runWithUser,
  setUserContext,
  sanitizeLogin,
  localDateStamp,
  filePathFor,
  lastDevicesPath,
  defaultLogDir,
  buildLine,
  UNKNOWN_USER,
  LAST_DEVICES_MAX,
  _userContext: userContext,
};
