-- reports.sales_by_customer: Reports > Sales by customer (src/screens/reports/sales.by.customer.report.tsx).
-- Guests who gave no name (orders without customer, and the shared CASH customer) add up on
-- one "Anonymous walk-ins" row.
-- One-shot grant: roles holding `reports.sales_summary` or `admin` get it.
-- update-asi-prod.ps1 re-runs this file; the marker keeps a removed grant from coming back.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'sales_by_customer_report') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['reports.sales_by_customer'])
  WHERE (roles ?? []) CONTAINS 'reports.sales_summary' OR (roles ?? []) CONTAINS 'admin';
  CREATE _schema_migration SET name = 'sales_by_customer_report', note = 'reports.sales_by_customer to sales summary / admin roles';
};
