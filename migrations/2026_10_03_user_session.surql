-- Live POS sessions, one row per session (id = jti) — gateway/src/active-session-store.js.
-- A login from another device replaces the user's other rows: the gateway revokes those
-- sessions and closes their database sockets (one device per user). Kept in the database
-- so a gateway restart (every prod update) still knows which sessions to replace. Idempotent.

DEFINE TABLE IF NOT EXISTS user_session TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS user ON user_session TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS jti ON user_session TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS device_id ON user_session TYPE option<string> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS expires_at ON user_session TYPE datetime PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON user_session TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS user_session_user ON user_session FIELDS user;
