-- Cashier asks to open house credit for a customer who is not yet credit_allowed.
-- Holders of credit.approve decide on their terminal and may set an optional credit_limit
-- (src/lib/credit-request.ts). Credit tender stays gated by checkCreditCharge.
-- One statement per line so `surreal sql` via docker does not drop block bodies.
-- Idempotent.

DEFINE TABLE IF NOT EXISTS customer_credit_request TYPE NORMAL SCHEMALESS PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS customer ON customer_credit_request TYPE record<customer> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS order ON customer_credit_request TYPE option<record<order>> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS requested_by ON customer_credit_request TYPE record<user> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS status ON customer_credit_request TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS approved_limit ON customer_credit_request TYPE option<float> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON customer_credit_request TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS decided_by ON customer_credit_request TYPE option<record<user>> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS decided_at ON customer_credit_request TYPE option<datetime> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS customer_credit_request_status ON customer_credit_request FIELDS status;
DEFINE INDEX IF NOT EXISTS customer_credit_request_customer ON customer_credit_request FIELDS customer;

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'customer_credit_request_roles') = 0 { UPDATE user_role SET roles = array::union(roles ?? [], ['credit.approve']) WHERE (roles ?? []) CONTAINS 'customers.preferences'; CREATE _schema_migration SET name = 'customer_credit_request_roles', note = 'credit.approve to customers.preferences holders'; };
IF array::len(SELECT name FROM _schema_migration WHERE name = 'customer_credit_request') = 0 { CREATE _schema_migration SET name = 'customer_credit_request', note = 'customer_credit_request table + credit.approve'; };
