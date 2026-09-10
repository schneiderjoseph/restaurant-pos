'use strict';

/**
 * Create the FIRST admin account on a fresh posr/posr DB.
 *
 * A fresh database has zero `user` rows, so nobody can log in and the UI has
 * no "create the first user" screen. This script seeds:
 *   1. a `user_role` named "Master" with every permission from
 *      migrations/2026_08_24_master_all_permissions.surql (one source of truth)
 *   2. a `user` with a 4-digit PIN login (password = bcrypt(pin)) linked to it
 *
 * Refuses to run if a non-deleted `user` already exists - manage the rest from
 * Admin -> Users inside the app.
 *
 * Env: SURREAL_URL, SURREAL_NS (default posr), SURREAL_DB (default posr),
 *      SURREAL_USER, SURREAL_PASS,
 *      ADMIN_PIN (required, exactly 4 digits),
 *      ADMIN_FIRST_NAME (default "Admin"), ADMIN_LAST_NAME (default "POSR")
 *
 * Usage (repo root): $env:ADMIN_PIN="1234"; node migrations/scripts/bootstrap-admin-user.cjs
 */

const fs = require('fs');
const path = require('path');
const WS = require('ws');
const { Surreal } = require('surrealdb');

if (typeof global.WebSocket === 'undefined') global.WebSocket = WS;

const url = process.env.SURREAL_URL || 'ws://127.0.0.1:8000/rpc';
const ns = process.env.SURREAL_NS || 'posr';
const dbName = process.env.SURREAL_DB || 'posr';
const user = process.env.SURREAL_USER;
const pass = process.env.SURREAL_PASS;
const pin = String(process.env.ADMIN_PIN || '').trim();
const firstName = (process.env.ADMIN_FIRST_NAME || 'Admin').trim();
const lastName = (process.env.ADMIN_LAST_NAME || 'POSR').trim();

if (!user || !pass) {
  console.error('ERROR: SURREAL_USER and SURREAL_PASS are required.');
  process.exit(1);
}
if (!/^\d{4}$/.test(pin)) {
  console.error('ERROR: ADMIN_PIN must be exactly 4 digits (e.g. ADMIN_PIN=4271).');
  process.exit(1);
}

const root = path.join(__dirname, '..', '..');
const MASTER_PERMS_FILE = 'migrations/2026_08_24_master_all_permissions.surql';

/** Pull the permission string list out of the `SET roles = [ ... ]` migration. */
function readMasterPermissions() {
  const raw = fs.readFileSync(path.join(root, MASTER_PERMS_FILE), 'utf8');
  const open = raw.indexOf('[');
  const close = raw.indexOf(']', open);
  if (open === -1 || close === -1) {
    throw new Error(`Could not find the roles array in ${MASTER_PERMS_FILE}`);
  }
  const perms = raw
    .slice(open + 1, close)
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
  if (perms.length < 50) {
    throw new Error(`Parsed only ${perms.length} permissions from ${MASTER_PERMS_FILE} - aborting`);
  }
  return perms;
}

function firstRow(result) {
  const top = Array.isArray(result) ? result[0] : result;
  if (Array.isArray(top)) return top[0] ?? null;
  return top ?? null;
}

async function main() {
  const perms = readMasterPermissions();
  console.log(`Seeding first admin on ${url} -> ${ns}/${dbName}`);

  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  const existing = await db.query(
    'SELECT count() FROM user WHERE deleted_at = NONE GROUP ALL'
  );
  const count = firstRow(existing)?.count ?? 0;
  if (count > 0) {
    console.log(
      `${count} user(s) already exist - nothing to seed. Manage accounts from Admin -> Users.`
    );
    await db.close();
    return;
  }

  // Master role: reuse an existing "Master" row if one is somehow there.
  let role = firstRow(
    await db.query("SELECT * FROM user_role WHERE name = 'Master' AND deleted_at = NONE LIMIT 1")
  );
  if (!role) {
    role = firstRow(
      await db.query('CREATE user_role SET name = $name, roles = $roles, deleted_at = NONE', {
        name: 'Master',
        roles: perms,
      })
    );
    console.log(`  created user_role "Master" (${perms.length} permissions)`);
  } else {
    await db.query('UPDATE $id SET roles = $roles', { id: role.id, roles: perms });
    console.log(`  updated existing user_role "Master" (${perms.length} permissions)`);
  }

  await db.query(
    `CREATE user SET
       login = $pin,
       password = crypto::bcrypt::generate($pin),
       login_method = 'pin',
       first_name = $firstName,
       last_name = $lastName,
       roles = [],
       user_role = $roleId,
       deleted_at = NONE`,
    { pin, firstName, lastName, roleId: role.id }
  );

  console.log(`  created admin user "${firstName} ${lastName}" - PIN login ${pin}`);
  console.log('Done. Log in on the POS with that PIN, then create the real staff accounts.');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
