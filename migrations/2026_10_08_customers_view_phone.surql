-- customers.view_phone: see a customer's phone in full (src/lib/access.rules.ts).
-- Without it, the UI shows only the last four digits (maskPhone / visiblePhone).
-- Search still matches the full number via phone_e164.
-- One-shot grant: roles holding `admin` get customers.view_phone (same as view_id_document).
-- update-asi-prod.ps1 re-runs this file; the marker keeps a removed grant from coming back.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'customers_view_phone') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['customers.view_phone'])
  WHERE (roles ?? []) CONTAINS 'admin';
  CREATE _schema_migration SET name = 'customers_view_phone', note = 'customers.view_phone to admin roles';
};
