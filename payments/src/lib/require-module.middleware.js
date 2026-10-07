'use strict';

const { getClient } = require('./surreal-client');
const { sendError } = require('./response');

/**
 * Role modules that may manage payment type credentials. Mirrors the POS permission
 * ids (src/lib/access.rules.ts), including the legacy English labels still stored on
 * older roles.
 */
const PAYMENT_TYPE_ADMIN_MODULES = new Set([
  'admin',
  'Admin',
  'admin.*',
  'super_admin',
  'admin.payment_types',
  'admin.payment_types.create',
  'admin.payment_types.update',
  'Payment Types',
]);

function firstRow(result) {
  const top = Array.isArray(result) ? result[0] : result;
  return Array.isArray(top) ? top[0] ?? null : top ?? null;
}

async function loadRoleModules(userId) {
  const db = await getClient();
  const user = firstRow(
    await db.query(
      'SELECT user_role.roles AS roles, user_role.deleted_at AS role_deleted_at FROM ONLY type::record($id) WHERE deleted_at = NONE',
      { id: String(userId) }
    )
  );
  if (!user || user.role_deleted_at != null) return [];
  return Array.isArray(user.roles) ? user.roles.map(String) : [];
}

/** Runs after the session middleware: the signed-in user's role must grant payment type admin. */
function requirePaymentTypeAdmin() {
  return async (req, res, next) => {
    const userId = req.posSession?.sub;
    // No session = auth is turned off on this server (GATEWAY_AUTH_REQUIRED=false).
    if (!userId) return next();
    try {
      const modules = await loadRoleModules(userId);
      if (modules.some((m) => PAYMENT_TYPE_ADMIN_MODULES.has(m))) return next();
      return sendError(res, 403, 'Your role cannot manage payment credentials');
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requirePaymentTypeAdmin, PAYMENT_TYPE_ADMIN_MODULES };
