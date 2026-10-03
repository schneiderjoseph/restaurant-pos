-- A server sees only the orders they opened unless their role holds order_visibility.all.
-- Every existing role gets it once, so nothing changes on deploy: remove it from the
-- server roles in the role editor. Roles created later start without it.
-- One-shot: update-asi-prod.ps1 re-runs this file on every update, so a marker in
-- _schema_migration keeps a removed grant from coming back.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'order_visibility_grant_existing_roles') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['order_visibility.all']);
  CREATE _schema_migration SET name = 'order_visibility_grant_existing_roles', note = 'order_visibility.all on every role that existed';
};
