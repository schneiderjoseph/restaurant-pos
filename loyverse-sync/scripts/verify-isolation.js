'use strict';
const WS = require('ws');
global.WebSocket = WS;
const { Surreal } = require('surrealdb');

(async () => {
  const db = new Surreal();
  await db.connect('ws://127.0.0.1:8001/rpc', {
    authentication: { username: 'posr', password: 'posr-local-dev-change-me' },
  });

  await db.use({ namespace: 'posr', database: 'posr' });
  const s = await db.query(`SELECT values FROM setting WHERE key = 'menus' AND is_global = true`);
  const lv = await db.query(
    `SELECT count() AS c FROM menu_item WHERE source = 'loyverse' AND (deleted_at = NONE OR deleted_at = NULL) GROUP ALL`,
  );
  console.log('posr menus', JSON.stringify(s[0]));
  console.log('posr live loyverse items', JSON.stringify(lv[0]));

  await db.use({ namespace: 'loyverse', database: 'loyverse' });
  const a = await db.query(
    `SELECT count() AS c FROM menu_item WHERE source = 'loyverse' AND deleted_at = NONE GROUP ALL`,
  );
  const b = await db.query(`SELECT count() AS c FROM customer WHERE source = 'loyverse' GROUP ALL`);
  const c = await db.query(
    `SELECT count() AS c FROM payment_type WHERE source = 'loyverse' AND deleted_at = NONE GROUP ALL`,
  );
  const m = await db.query(`SELECT id, array::len(items) AS n FROM menu:loyverse_catalog`);
  console.log('loyverse DB', JSON.stringify({ items: a[0], customers: b[0], payments: c[0], menu: m[0] }));

  await db.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
