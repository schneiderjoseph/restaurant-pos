'use strict';

const http = require('http');
const crypto = require('crypto');
const { config } = require('./config');
const { connectSurreal } = require('./surreal');
const { upsertMirrorRecord } = require('./mirror-upsert');
const { getResource } = require('./resources');

const EVENT_RESOURCE = {
  'items.update': 'item',
  'inventory_levels.update': 'inventory',
  'customers.update': 'customer',
  'receipts.update': 'receipt',
  'shifts.create': 'shift',
  'categories.update': 'category',
  'modifiers.update': 'modifier',
};

function verifySignature(rawBody, signatureHeader) {
  if (!config.webhookSecret) return true;
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', config.webhookSecret)
    .update(rawBody)
    .digest('hex');
  const provided = String(signatureHeader).replace(/^sha256=/, '');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return expected === provided;
  }
}

/**
 * @param {import('surrealdb').Surreal} db
 * @param {string} eventType
 * @param {object} payload
 */
async function handleWebhookEvent(db, eventType, payload) {
  const resourceKey = EVENT_RESOURCE[eventType];
  if (!resourceKey) {
    return { handled: false, reason: 'unknown_event' };
  }
  const def = getResource(resourceKey === 'inventory' ? 'inventory' : resourceKey);
  const record = payload?.object || payload?.data || payload;
  if (!record || typeof record !== 'object') {
    return { handled: false, reason: 'empty_payload' };
  }
  await upsertMirrorRecord(db, def, record);
  return { handled: true, resource: def.resource };
}

function startWebhookServer(db) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/webhooks/loyverse') {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const raw = Buffer.concat(chunks);
      const sig =
        req.headers['x-loyverse-signature'] ||
        req.headers['x-loyverse-webhook-signature'] ||
        '';
      if (!verifySignature(raw, sig)) {
        res.writeHead(401);
        res.end('invalid signature');
        return;
      }

      let body;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        res.writeHead(400);
        res.end('invalid json');
        return;
      }

      try {
        const eventType = body.type || body.event || '';
        const result = await handleWebhookEvent(db, eventType, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, ...result }));
      } catch (err) {
        console.error('[webhook]', err);
        res.writeHead(500);
        res.end('error');
      }
    });
  });

  server.listen(config.webhookPort, () => {
    console.log(`[loyverse-webhook] listening on :${config.webhookPort}/webhooks/loyverse`);
  });
  return server;
}

async function main() {
  if (config.surreal.ns === 'posr' && config.surreal.db === 'posr') {
    throw new Error('Refusing webhook server on posr/posr');
  }
  const db = await connectSurreal(config.surreal);
  startWebhookServer(db);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { startWebhookServer, handleWebhookEvent, verifySignature };
