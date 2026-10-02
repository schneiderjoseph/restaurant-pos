-- Idle sign-out on for every user: 15 minutes, then logout (the same user who
-- signs back in resumes where they were; anyone else starts at the menu).
-- Users without a row already get this from DEFAULT_SESSION_SECURITY; this
-- resets the rows saved earlier (often disabled or set to lock).
-- One-shot: update-asi-prod.ps1 re-runs this file on every update, so a marker in
-- _schema_migration keeps later per-user changes from being reset again.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'session_security_default_reset') = 0 {
  UPDATE setting
  SET values = { enabled: true, idle_minutes: 15, idle_action: 'logout' }
  WHERE key = 'session_security';
  CREATE _schema_migration SET name = 'session_security_default_reset', note = 'idle logout 15 min for every user';
};
