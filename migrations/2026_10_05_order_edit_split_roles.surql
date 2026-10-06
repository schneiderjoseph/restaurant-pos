-- Approving a change to a sent line becomes its own role permission (src/lib/order-edit-request.ts):
--   order_edit.sent_items   changes sent lines directly, no approval
--   order_edit.approve      receives the requests of the others and accepts or refuses them
-- A user without order_edit.sent_items still changes sent lines; the change waits for an approver.
-- Before, order_edit.sent_items also made its holder the approver. So nothing changes on deploy,
-- its holders also get order_edit.approve. Untick it in the role editor.
-- One-shot: update-asi-prod.ps1 re-runs this file on every update, so a marker in
-- _schema_migration keeps a removed grant from coming back.

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'order_edit_split_roles') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['order_edit.approve'])
  WHERE (roles ?? []) CONTAINS 'order_edit.sent_items';
  CREATE _schema_migration SET name = 'order_edit_split_roles', note = 'order_edit.approve to the order_edit.sent_items holders';
};
