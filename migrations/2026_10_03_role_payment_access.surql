-- Who may take a payment, and with which payment types.
--   payments.receive         permission in user_role.roles: without it a user cannot add a
--                            tender or complete an order.
--   user_role.payment_types  the payment types the role may take; NONE / empty = every type.
-- Every existing role gets payments.receive once, so nothing changes on deploy: remove it from
-- the roles that must not cash in the role editor. Roles created later start without it.
-- One-shot: update-asi-prod.ps1 re-runs this file on every update, so a marker in
-- _schema_migration keeps a removed grant from coming back.

DEFINE FIELD IF NOT EXISTS payment_types ON user_role TYPE none | array<record<payment_type>> | null PERMISSIONS FULL;

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'payments_receive_grant_existing_roles') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['payments.receive']);
  CREATE _schema_migration SET name = 'payments_receive_grant_existing_roles', note = 'payments.receive on every role that existed';
};
