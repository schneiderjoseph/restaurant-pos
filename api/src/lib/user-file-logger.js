'use strict';

/**
 * Re-export repo shared/user-file-logger (Docker: /shared, local: walk up to repo).
 * If it cannot be found (e.g. container started before ./shared was mounted), fall
 * back to a no-op logger: per-user logs are best-effort and must never stop a service.
 */
const fs = require('fs');
const path = require('path');

function resolve() {
  if (fs.existsSync('/shared/user-file-logger.js')) {
    return '/shared/user-file-logger';
  }
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'shared', 'user-file-logger');
    if (fs.existsSync(`${candidate}.js`)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function noopLogger() {
  console.warn(
    '[user-file-logger] shared/user-file-logger.js not found — per-user file logs disabled. ' +
      'Recreate the container (docker compose up -d) so ./shared is mounted.',
  );
  const noop = () => {};
  return {
    appendUserLog: noop,
    recordDeviceConnection: noop,
    runWithUser: (_user, fn) => fn(),
    setUserContext: noop,
    sanitizeLogin: (user) => String(user || '_unknown'),
    localDateStamp: (date = new Date()) => date.toISOString().slice(0, 10),
    filePathFor: () => null,
    lastDevicesPath: () => null,
    defaultLogDir: () => null,
    buildLine: () => '',
    UNKNOWN_USER: '_unknown',
    LAST_DEVICES_MAX: 0,
    _userContext: { getStore: () => undefined, run: (_store, fn) => fn() },
  };
}

const target = resolve();
module.exports = target ? require(target) : noopLogger();
