'use strict';
/**
 * Copy login users (+ user_role) from posr/posr → loyverse/loyverse so the UI can sign in.
 */
const WS = require('ws');
global.WebSocket = WS;
const { Surreal, StringRecordId } = require('surrealdb');

function rows(result) {
  const first = Array.isArray(result) ? result[0] : result;
  return Array.isArray(first) ? first : first != null ? [first] : [];
}

(async () => {
  const db = new Surreal();
  await db.connect('ws://127.0.0.1:8001/rpc', {
    authentication: { username: 'posr', password: 'posr-local-dev-change-me' },
  });

  await db.use({ namespace: 'posr', database: 'posr' });
  const userRows = rows(await db.query(`SELECT * FROM user`));
  const roleRows = rows(await db.query(`SELECT * FROM user_role`));
  console.log(`Source: ${userRows.length} users, ${roleRows.length} user_roles`);

  await db.use({ namespace: 'loyverse', database: 'loyverse' });

  for (const role of roleRows) {
    const id = String(role.id);
    const copy = { ...role };
    delete copy.id;
    try {
      await db.query(`UPSERT $id CONTENT $data`, {
        id: new StringRecordId(id),
        data: copy,
      });
    } catch (err) {
      try {
        await db.query(`CREATE $id CONTENT $data`, {
          id: new StringRecordId(id),
          data: copy,
        });
      } catch (e2) {
        console.warn('role fail', id, e2.message);
      }
    }
  }

  for (const user of userRows) {
    const id = String(user.id);
    const copy = { ...user };
    delete copy.id;
    try {
      await db.query(`UPSERT $id CONTENT $data`, {
        id: new StringRecordId(id),
        data: copy,
      });
    } catch (err) {
      try {
        await db.query(`CREATE $id CONTENT $data`, {
          id: new StringRecordId(id),
          data: copy,
        });
      } catch (e2) {
        console.warn('user fail', id, e2.message);
      }
    }
  }

  const check = rows(await db.query(`SELECT id, login, name FROM user`));
  console.log(
    'loyverse users:',
    check.map((u) => ({ id: String(u.id), login: u.login, name: u.name })),
  );
  await db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
