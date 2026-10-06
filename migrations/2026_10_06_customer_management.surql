-- Customer management (src/lib/customer.service.ts, Manage > Clients).
--
-- Identity: a customer is its record id, its customer number, its phone and its ID document.
-- The name never identifies anyone: two clients may carry the same name.
--   number               customer number shown as C-000123, from the customer_number sequence.
--   phone_e164           computed from phone ("+50937473889"). Shared phones are allowed
--                        (a family, a company): it is indexed, not unique.
--                        A phone without "+" or "00" is read as Haitian (+509) when it has 8 digits.
--   id_document_key      computed: the ID document of an active, non-ASI customer. UNIQUE, so two
--                        active clients never hold the same ID. A deleted or merged customer frees
--                        it; ASI stays of one guest may repeat it.
--
-- Soft delete only: deleted_at / deleted_by / deleted_reason; merged_into marks a duplicate folded
-- into another customer (its orders stay on it and are shown with the kept customer).
-- A DELETE on customer always fails (event customer_never_deleted), whoever runs it.
--
-- Preferences: allergies, dietary, seating_pref, language, birthday, vip, marketing_consent,
-- plus the existing free-text notes. Allergies print on kitchen tickets.
--
-- Rights (src/lib/access.rules.ts):
--   customers.create            register a walk-in from the POS
--   customers.preferences       edit allergies, diet, notes from the POS
--   customers.view_id_document  see an ID document in full
--   admin.customers[.update|.delete|.merge]  Manage > Clients
-- One-shot grant: every role holding `menu` gets customers.create and customers.preferences, so
-- servers keep registering walk-ins; roles holding `admin` get customers.view_id_document.
--
-- Run migrations/scripts/audit-customer-duplicates.cjs first: active customers sharing an ID
-- document are folded here (the one with the most orders is kept) before the UNIQUE index.
-- Safe to re-run.

DEFINE FIELD IF NOT EXISTS deleted_at ON customer TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS deleted_by ON customer TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS deleted_reason ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS merged_into ON customer TYPE none | record<customer> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON customer TYPE none | datetime | null DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_by ON customer TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS updated_at ON customer TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS updated_by ON customer TYPE none | record<user> | null PERMISSIONS FULL;

DEFINE FIELD IF NOT EXISTS id_document_type ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS allergies ON customer TYPE none | array<string> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS dietary ON customer TYPE none | array<string> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS seating_pref ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS language ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS birthday ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS vip ON customer TYPE none | bool | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS marketing_consent ON customer TYPE none | bool | null PERMISSIONS FULL;

-- Same rules as toE164() in src/lib/phone.ts.
DEFINE FIELD OVERWRITE phone_e164 ON customer VALUE {
  LET $raw = string::trim(<string>(phone ?? ''));
  LET $d = string::replace($raw, /[^0-9]/, '');
  RETURN IF string::len($d) < 6 { NONE }
    ELSE IF string::starts_with($raw, '+') { '+' + $d }
    ELSE IF string::starts_with($d, '00') { '+' + string::slice($d, 2) }
    ELSE IF string::len($d) = 8 { '+509' + $d }
    ELSE { '+' + $d };
} PERMISSIONS FULL;

DEFINE FIELD OVERWRITE id_document_key ON customer VALUE
  IF deleted_at = NONE AND merged_into = NONE AND asi_guest_id = NONE
    AND id_document_number != NONE AND id_document_number != NULL AND id_document_number != ''
  { id_document_number } ELSE { NONE }
PERMISSIONS FULL;

-- Fold active customers sharing an ID document (kept: most orders, then oldest id).
DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

FOR $group IN (
  SELECT id_document_number, array::group(id) AS ids FROM customer
  WHERE deleted_at = NONE AND merged_into = NONE AND asi_guest_id = NONE
    AND id_document_number != NONE AND id_document_number != NULL AND id_document_number != ''
  GROUP BY id_document_number
) {
  IF array::len($group.ids) > 1 {
    LET $ranked = (
      SELECT id, (SELECT count() FROM order WHERE customer = $parent.id GROUP ALL)[0].count ?? 0 AS orders
      FROM $group.ids
      ORDER BY orders DESC, id ASC
    );
    LET $keep = $ranked[0].id;
    FOR $dup IN array::slice($ranked, 1) {
      UPDATE $dup.id SET
        merged_into = $keep,
        deleted_at = time::now(),
        deleted_reason = 'Duplicate ID document, merged by migration 2026_10_06_customer_management';
    };
  };
};

DEFINE INDEX OVERWRITE customer_id_document_key ON customer FIELDS id_document_key UNIQUE;
DEFINE INDEX OVERWRITE customer_phone_e164 ON customer FIELDS phone_e164;
DEFINE INDEX OVERWRITE customer_deleted_at ON customer FIELDS deleted_at;
DEFINE INDEX OVERWRITE customer_merged_into ON customer FIELDS merged_into;

-- Computes phone_e164 and id_document_key on the existing rows.
UPDATE customer;

-- Customer numbers: existing customers (table order), then the sequence for new ones.
-- Not a FOR over a SELECT: SurrealDB 3 fails a FOR whose SELECT returns nothing (on a re-run).
DEFINE SEQUENCE IF NOT EXISTS customer_number START 1;
UPDATE customer SET number = sequence::nextval('customer_number') WHERE number = NONE;
DEFINE FIELD OVERWRITE number ON customer TYPE none | int DEFAULT sequence::nextval('customer_number') PERMISSIONS FULL;
DEFINE INDEX OVERWRITE customer_number ON customer FIELDS number UNIQUE;

DEFINE EVENT OVERWRITE customer_never_deleted ON TABLE customer WHEN $event = 'DELETE' THEN {
  THROW 'Customers are never deleted: set deleted_at (soft delete) instead.';
};

IF array::len(SELECT name FROM _schema_migration WHERE name = 'customer_management_grants') = 0 {
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['customers.create', 'customers.preferences'])
  WHERE (roles ?? []) CONTAINS 'menu';
  UPDATE user_role
  SET roles = array::union(roles ?? [], ['customers.view_id_document'])
  WHERE (roles ?? []) CONTAINS 'admin';
  CREATE _schema_migration SET name = 'customer_management_grants', note = 'customers.create/preferences to menu roles, view_id_document to admin roles';
};
