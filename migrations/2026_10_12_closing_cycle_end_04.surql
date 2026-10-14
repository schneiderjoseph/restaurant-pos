-- Default closing cycle end moves from 02:00 to 04:00 so the cashier can
-- finish the night service and still close the business day manually.
-- Only rewrites the prior default (02:00); a custom end_time is left alone.
-- One-shot: update-asi-prod.ps1 re-runs this file on every update.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'closing_cycle_end_04') = 0 {
  UPDATE setting
  SET values.end_time = '04:00'
  WHERE key = 'closing_cycle'
    AND is_global = true
    AND values.end_time = '02:00';
  CREATE _schema_migration SET name = 'closing_cycle_end_04', note = 'closing cycle default end 02:00 -> 04:00';
};
