-- Two open discounts so the Discount panel of the payment screen works out of the box:
--   discount:free_percent  any rate from 0 to 100 %, typed on the keypad
--   discount:free_amount   any amount, typed on the keypad (never more than the items total)
-- Who may use them is the role permission orders.apply_discount. Rename, cap (max_value) or
-- delete them in Manage → Discounts.
-- One-shot: update-asi-prod.ps1 re-runs this file on every update, so a marker in
-- _schema_migration keeps a discount deleted on purpose from coming back.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'free_discounts_seed') = 0 {
  UPSERT discount:free_percent CONTENT {
    name: 'Remise libre %',
    type: 'Percent',
    value_type: 'percent',
    min_value: 0.0,
    max_value: 100.0,
    min_rate: 0.0,
    max_rate: 100.0,
    category: 'manual',
    scope: 'cart',
    application_mode: 'manual',
    priority: 1
  };
  UPSERT discount:free_amount CONTENT {
    name: 'Remise libre (montant)',
    type: 'Fixed',
    value_type: 'fixed_amount',
    min_value: 0.0,
    max_value: 100000000.0,
    category: 'manual',
    scope: 'cart',
    application_mode: 'manual',
    priority: 2
  };
  CREATE _schema_migration SET name = 'free_discounts_seed', note = 'open percent and amount discounts for the payment screen';
};
