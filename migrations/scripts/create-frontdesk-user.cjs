'use strict';

/**
 * Create a PIN user linked to the seeded "Front Desk" role.
 *
 * Env: SURREAL_URL (default ws://127.0.0.1:8000/rpc), SURREAL_NS, SURREAL_DB,
 *      SURREAL_USER, SURREAL_PASS,
 *      FD_PIN (optional 4 digits; picks a free PIN if omitted),
 *      FD_FIRST_NAME (default "Front"), FD_LAST_NAME (default "Desk")
 *
 * Usage (repo root):
 *   node migrations/scripts/create-frontdesk-user.cjs
 *   $env:FD_PIN="4488"; node migrations/scripts/create-frontdesk-user.cjs
 */

const fs = require('fs');
const path = require('path');
const WS = require('ws');
const { Surreal } = require('surrealdb');

const ROOT = path.join(__dirname, '..', '..');
try {
  require(path.join(ROOT, 'asi-sync', 'node_modules', 'dotenv')).config({
    path: path.join(ROOT, '.env'),
  });
} catch {
  // dotenv optional when env vars are already set
}

if (typeof global.WebSocket === 'undefined') global.WebSocket = WS;

const url = process.env.SURREAL_URL || 'ws://127.0.0.1:8000/rpc';
const ns = process.env.SURREAL_NS || 'posr';
const dbName = process.env.SURREAL_DB || 'posr';
const user = process.env.SURREAL_USER;
const pass = process.env.SURREAL_PASS;
const firstName = (process.env.FD_FIRST_NAME || 'Front').trim();
const lastName = (process.env.FD_LAST_NAME || 'Desk').trim();
let pin = String(process.env.FD_PIN || '').trim();

if (!user || !pass) {
  console.error('ERROR: SURREAL_USER and SURREAL_PASS are required.');
  process.exit(1);
}
if (pin && !/^\d{4}$/.test(pin)) {
  console.error('ERROR: FD_PIN must be exactly 4 digits when set.');
  process.exit(1);
}

function firstRow(result) {
  const top = Array.isArray(result) ? result[0] : result;
  if (Array.isArray(top)) return top[0] ?? null;
  return top ?? null;
}

function pickFreePin(taken) {
  const used = new Set((taken || []).map(String));
  for (let i = 0; i < 10000; i++) {
    const candidate = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    if (!used.has(candidate)) return candidate;
  }
  return null;
}

async function main() {
  const db = new Surreal();
  await db.connect(url, {
    namespace: ns,
    database: dbName,
    authentication: { username: user, password: pass },
  });

  let role = firstRow(
    await db.query(
      "SELECT * FROM user_role WHERE name = 'Front Desk' AND deleted_at = NONE LIMIT 1"
    )
  );

  if (!role) {
    role = firstRow(
      await db.query(
        `CREATE user_role SET
           name = 'Front Desk',
           roles = [
             'frontdesk',
             'frontdesk.checkin',
             'frontdesk.checkout',
             'frontdesk.move',
             'customers.create',
             'customers.preferences',
             'customers.view_phone',
             'customers.view_id_document'
           ],
           priority = 50,
           deleted_at = NONE`
      )
    );
    console.log('  created user_role "Front Desk"');
  } else {
    console.log(`  using existing user_role "Front Desk" (${role.id})`);
  }

  if (!pin) {
    const loginsResult = await db.query(
      'SELECT VALUE login FROM user WHERE deleted_at = NONE'
    );
    const logins = Array.isArray(loginsResult?.[0]) ? loginsResult[0] : [];
    pin = pickFreePin(logins);
    if (!pin) {
      console.error('ERROR: no free 4-digit PIN left.');
      await db.close();
      process.exit(1);
    }
  } else {
    const owner = firstRow(
      await db.query(
        `SELECT id, first_name, last_name FROM user
         WHERE login = $pin AND (deleted_at = NONE OR deleted_at = NULL) LIMIT 1`,
        { pin }
      )
    );
    if (owner) {
      console.error(
        `ERROR: PIN ${pin} already used by ${owner.first_name || ''} ${owner.last_name || ''} (${owner.id}).`
      );
      await db.close();
      process.exit(1);
    }
  }

  const created = firstRow(
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
    )
  );

  console.log(`  created user "${firstName} ${lastName}" (${created?.id})`);
  console.log(`  role: Front Desk`);
  console.log(`  PIN:  ${pin}`);
  console.log('Done. Sign in on the POS with that PIN to open Front Desk.');
  await db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
