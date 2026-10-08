-- Front Desk stay hardening: table permissions, cash settlements for Room folio.
-- stay_settlement records real Cash/Card collections against a manual stay folio; each one
-- is also a Paid order (tag stay-settlement) so the closing and cash reports count the money.
-- (stay itself is PERMISSIONS NONE since 2026_10_08_manual_stay.surql.)

DEFINE TABLE IF NOT EXISTS stay_settlement TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS stay ON stay_settlement TYPE record<stay> PERMISSIONS FULL;
-- The Paid order (tag stay-settlement) that carries the cash/card payment in the closing.
DEFINE FIELD IF NOT EXISTS order ON stay_settlement TYPE none | record<order> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS amount ON stay_settlement TYPE float PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS payment_type ON stay_settlement TYPE record<payment_type> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_by ON stay_settlement TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON stay_settlement TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS comments ON stay_settlement TYPE none | string | null PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS stay_settlement_stay ON stay_settlement FIELDS stay;

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'manual_stay_fix') = 0 {
  CREATE _schema_migration SET
    name = 'manual_stay_fix',
    note = 'stay PERMISSIONS NONE + stay_settlement for folio cash/card';
};
