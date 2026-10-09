'use strict';

const { getClient } = require('../surreal-client');
const { appendUserLog } = require('../user-file-logger');

const TRACKING_TABLE = 'tracking';

function orderIdFromPayload(payload) {
  const nested = payload?.payload;
  const raw =
    payload?.order ??
    payload?.order_id ??
    payload?.orderId ??
    (nested && typeof nested === 'object'
      ? nested.order ?? nested.order_id ?? nested.orderId
      : undefined);
  if (raw == null || raw === '') return undefined;
  return String(raw);
}

function mirrorTrackingToFile(payload, sessionLogin) {
  appendUserLog({
    user: sessionLogin || payload?.user || '_unknown',
    level: 'ACTION',
    service: 'tracking',
    action: payload?.module || 'tracking',
    meta: {
      page: payload?.page,
      order: orderIdFromPayload(payload),
    },
  });
}

function normalizeTrackingPayload(raw) {
  const payload = { ...(raw || {}) };

  // The audit trail is dated by the server, never by the client.
  payload.created_at = new Date();

  if (!payload.page) {
    payload.page = 'unknown';
  }

  if (!payload.user) {
    payload.user = 'unknown';
  }

  return payload;
}

function toTrackingId(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (text.length === 0) return null;

  // SECURITY: Prevent the client from choosing arbitrary record IDs that could
  // collide with system records or overwrite other tracking rows. SurrealDB's
  // CREATE type::record($table, $id) succeeds even if the id already exists
  // (it overwrites). We restrict the id format to a safe pattern: alphanumeric
  // + dashes + underscores, max 128 chars. This prevents:
  //   - Table-qualified IDs like 'user:abc' (cross-table overwrite)
  //   - IDs with colons (record separator)
  //   - IDs with spaces or special chars
  //   - Extremely long IDs (DoS)
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(text)) {
    return null;
  }

  return text;
}

/** Display name of the signed-in user, so a client cannot log events under someone else. */
async function sessionUserName(client, userId) {
  if (!userId) return null;
  try {
    const [row] = await client.query(
      'SELECT VALUE string::trim(string::concat(first_name ?? "", " ", last_name ?? "")) FROM ONLY type::record($id)',
      { id: String(userId) }
    );
    const name = Array.isArray(row) ? row[0] : row;
    return typeof name === 'string' && name ? name : null;
  } catch {
    return null;
  }
}

async function createTracking(rawPayload, sessionUserId, sessionLogin) {
  const client = await getClient();
  const payload = normalizeTrackingPayload(rawPayload);
  const name = await sessionUserName(client, sessionUserId);
  if (name) {
    payload.user = name;
  }
  const trackingId = toTrackingId(payload.id);

  let result;
  if (trackingId) {
    const { id, ...rest } = payload;
    const [created] = await client.query(
      'CREATE type::record($table, $id) CONTENT $data;',
      {
        table: TRACKING_TABLE,
        id: trackingId,
        data: rest,
      }
    );
    result = created;
  } else {
    const [created] = await client.query(
      'CREATE type::table($table) CONTENT $data;',
      {
        table: TRACKING_TABLE,
        data: payload,
      }
    );
    result = created;
  }

  mirrorTrackingToFile(payload, sessionLogin);
  return result;
}

module.exports = {
  createTracking,
};
