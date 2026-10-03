'use strict';

/**
 * One device per user.
 *
 * Every successful login is recorded. When the user still has live sessions opened on
 * another device, `claim` returns all of them so the caller can revoke them and drop
 * their sockets: the newest login wins, and a crashed or lost tablet never locks a user
 * out. Sessions from the same device (an unlock after lock, a reload, a second tab) are
 * kept: that device may still be using an older token.
 *
 * Sessions live in memory and in the `user_session` table (one row per session, id = jti),
 * so a gateway restart (every prod update) still knows which sessions to replace.
 */

const TABLE = 'user_session';

const logger = {
  warn: (...args) => console.warn('[active-session]', ...args),
};

let surrealClient = null;
/** userId -> Map<jti, { deviceId, expiresAt (ms) }> */
const memory = new Map();

function setSurrealClient(client) {
  surrealClient = client;
}

/** Surreal query results are nested: [[{...}]] or [{...}]. */
function rows(result) {
  const first = Array.isArray(result) ? result[0] : undefined;
  if (Array.isArray(first)) return first;
  return Array.isArray(result) ? result.filter((row) => row && typeof row === 'object') : [];
}

async function load(userId) {
  if (memory.has(userId)) return memory.get(userId);
  const sessions = new Map();
  if (surrealClient) {
    try {
      const found = rows(
        await surrealClient.query(`SELECT jti, device_id, expires_at FROM ${TABLE} WHERE user = $user`, {
          user: userId,
        })
      );
      for (const row of found) {
        if (!row.jti) continue;
        sessions.set(String(row.jti), {
          deviceId: row.device_id ? String(row.device_id) : null,
          expiresAt: new Date(row.expires_at).getTime(),
        });
      }
    } catch (err) {
      logger.warn(`read failed for ${userId}: ${err.message || err}`);
    }
  }
  memory.set(userId, sessions);
  return sessions;
}

async function persist(userId, added, removedJtis) {
  if (!surrealClient) return;
  try {
    if (removedJtis.length > 0) {
      await surrealClient.query(`DELETE ${TABLE} WHERE jti INSIDE $jtis`, { jtis: removedJtis });
    }
    await surrealClient.query(
      `CREATE type::record($table, $jti) CONTENT {
         user: $user, jti: $jti, device_id: $deviceId, expires_at: <datetime>$expiresAt
       }`,
      {
        table: TABLE,
        jti: added.jti,
        user: userId,
        deviceId: added.deviceId ?? undefined,
        expiresAt: new Date(added.expiresAt).toISOString(),
      }
    );
  } catch (err) {
    logger.warn(`write failed for ${userId} (kept in memory): ${err.message || err}`);
  }
}

/**
 * Record a new session for the user.
 * @returns the live sessions it displaces ([{ jti, expiresAt }]), opened on other devices.
 */
async function claim(userId, { jti, deviceId, expiresAt }, now = Date.now()) {
  if (!userId || !jti) return [];
  const key = String(userId);
  const device = deviceId ? String(deviceId) : null;
  const sessions = await load(key);

  const displaced = [];
  const removed = [];
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
      removed.push(id);
    } else if (!device || session.deviceId !== device) {
      sessions.delete(id);
      removed.push(id);
      displaced.push({ jti: id, expiresAt: session.expiresAt });
    }
  }

  sessions.set(String(jti), { deviceId: device, expiresAt });
  await persist(key, { jti: String(jti), deviceId: device, expiresAt }, removed);
  return displaced;
}

function _resetForTests() {
  memory.clear();
  surrealClient = null;
}

module.exports = {
  setSurrealClient,
  claim,
  _resetForTests,
};
