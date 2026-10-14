-- Front Desk collects room folios and credit accounts itself (payments.receive) and,
-- after checking out a stay ASI took over, folds the manual guest into the ASI one
-- (admin.customers.merge). Adds both rights to the seeded "Front Desk" role.
-- One-shot: update-asi-prod.ps1 re-runs this file on every update.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'frontdesk_receive_merge') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['payments.receive', 'admin.customers.merge'])
  WHERE name = 'Front Desk';
  CREATE _schema_migration SET name = 'frontdesk_receive_merge', note = 'Front Desk role: payments.receive + admin.customers.merge';
};
