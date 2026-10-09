'use strict';

const express = require('express');
const { authenticatePosUser } = require('./auth.service');
const { signSession, verifySession, revokeSession, extractBearer } = require('./jwt');
const { issueSurrealAccessToken } = require('./surreal-client');
const { loginRateLimit, recordAuthResult } = require('./rate-limiter');
const auditLog = require('./audit-log');
const activeSessions = require('./active-session-store');
const { closeSessionSockets } = require('./ws-relay');

/** Browser-generated id of the device, sent at login (`deviceId`). */
function readDeviceId(body) {
  const raw = body?.deviceId;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : null;
}

/**
 * One device per user: the new session replaces every live one opened on another device.
 * Each is revoked and its database socket closed, so that tablet stops at once.
 */
async function replaceOtherDeviceSession(user, session, deviceId) {
  const displaced = await activeSessions.claim(user.id, {
    jti: session.jti,
    deviceId,
    expiresAt: Date.now() + session.expiresIn * 1000,
  });
  for (const old of displaced) {
    await revokeSession(old.jti, Math.ceil(old.expiresAt / 1000));
    closeSessionSockets(old.jti);
    auditLog.logSessionRevoked(old.jti, user.id, user.login).catch(() => {});
  }
}

const router = express.Router();

router.post('/login', loginRateLimit(), async (req, res) => {
  try {
    const login = req.body?.login;
    const deviceId = readDeviceId(req.body);
    const clientIp = auditLog.clientIpFromReq(req);
    const userAgent = req.headers?.['user-agent']?.slice(0, 200) || null;
    const deviceMeta = { deviceId, userAgent };

    const user = await authenticatePosUser({ login });
    if (!user) {
      // SECURITY: record the failure for both IP and login buckets. Without
      // rate limiting a 4-digit PIN can be brute-forced in ~10,000 requests,
      // which bcrypt's slow compare alone cannot prevent.
      const limitInfo = recordAuthResult(req, false);
      if (limitInfo?.locked) {
        res.set('Retry-After', String(Math.ceil(limitInfo.retryAfterMs / 1000)));
        auditLog.logLoginFailure(
          login,
          clientIp,
          'rate_limited',
          deviceMeta
        ).catch(() => {});
        return res.status(429).json({
          ok: false,
          error: 'This account is temporarily locked due to repeated failed logins.',
          code: 'rate_limited_account',
          retryAfterMs: limitInfo.retryAfterMs,
          maxAttempts: limitInfo.maxAttempts,
          lockoutMs: limitInfo.lockoutMs,
        });
      }
      auditLog.logLoginFailure(
        login,
        clientIp,
        'invalid_credentials',
        deviceMeta
      ).catch(() => {});
      return res.status(401).json({
        ok: false,
        error: 'Invalid credentials',
        code: 'invalid_credentials',
        ...(limitInfo
          ? {
              attemptsRemaining: limitInfo.attemptsRemaining,
              maxAttempts: limitInfo.maxAttempts,
              lockoutMs: limitInfo.lockoutMs,
            }
          : {}),
      });
    }

    recordAuthResult(req, true);

    // A station account (user.kitchen) is a shared screen login: as many devices as
    // needed, each with a long session.
    const isStationAccount = Boolean(user.kitchen);

    const session = await signSession({
      userId: user.id,
      login: user.login,
      station: isStationAccount,
    });

    // Before displacing the user's other devices: if the database token cannot be
    // issued the login fails, and those devices must keep their session.
    let surrealToken = null;
    try {
      surrealToken = await issueSurrealAccessToken();
    } catch (err) {
      console.error('Failed to issue Surreal access token', err);
      return res.status(503).json({
        ok: false,
        error: 'Database session unavailable',
      });
    }

    if (!isStationAccount) {
      try {
        await replaceOtherDeviceSession(user, session, deviceId);
      } catch (err) {
        // Never block a login on this: the new session stays valid either way.
        console.error('Replacing the previous session failed', err);
      }
    }

    // Audit log the successful login (for the login audit trail).
    auditLog.logLoginSuccess(
      user.id,
      user.login,
      session.roles,
      clientIp,
      deviceMeta
    ).catch(() => {});

    return res.json({
      ok: true,
      token: session.token,
      expiresIn: session.expiresIn,
      surrealToken,
      user,
    });
  } catch (err) {
    console.error('login error', err);
    if (err?.kind === 'NotAllowed' || /authentication/i.test(String(err?.message || ''))) {
      return res.status(503).json({
        ok: false,
        error:
          'Database authentication failed — SURREAL_USER/SURREAL_PASS must match the existing SurrealDB root user (the --user/--pass flags only apply on an empty data directory).',
      });
    }
    return res.status(500).json({ ok: false, error: 'Login failed' });
  }
});

router.get('/session', async (req, res) => {
  try {
    const payload = await verifySession(extractBearer(req));
    return res.json({ ok: true, session: payload });
  } catch (err) {
    return res.status(err.status || 401).json({
      ok: false,
      error: err.message,
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const payload = await verifySession(extractBearer(req));
    // Pass the token's `exp` so the revocation store can GC expired rows
    // after the natural TTL elapses.
    await revokeSession(payload.jti, payload.exp);
    closeSessionSockets(payload.jti);
    // Audit log the session revocation.
    auditLog.logSessionRevoked(payload.jti, payload.sub, payload.login).catch(() => {});
    return res.json({ ok: true });
  } catch {
    // Idempotent logout
    return res.json({ ok: true });
  }
});

/**
 * Refresh Surreal access token for an existing gateway session.
 * Used when the Surreal token expires but the POS session is still valid.
 */
router.post('/db-token', async (req, res) => {
  try {
    await verifySession(extractBearer(req));
    const surrealToken = await issueSurrealAccessToken();
    return res.json({ ok: true, surrealToken });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: err.message || 'Failed to refresh database token',
    });
  }
});

module.exports = router;
