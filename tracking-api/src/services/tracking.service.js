'use strict';

const { getClient } = require('../surreal-client');

const TRACKING_TABLE = 'tracking';

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

async function createTracking(rawPayload, sessionUserId) {
  const client = await getClient();
  const payload = normalizeTrackingPayload(rawPayload);
  const name = await sessionUserName(client, sessionUserId);
  if (name) {
    payload.user = name;
  }
  const trackingId = toTrackingId(payload.id);

  if (trackingId) {
    const { id, ...rest } = payload;
    const [result] = await client.query(
      'CREATE type::record($table, $id) CONTENT $data;',
      {
        table: TRACKING_TABLE,
        id: trackingId,
        data: rest,
      }
    );
    return result;
  }

  const [result] = await client.query(
    'CREATE type::table($table) CONTENT $data;',
    {
      table: TRACKING_TABLE,
      data: payload,
    }
  );
  return result;
}

module.exports = {
  createTracking,
};
