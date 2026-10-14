-- House-account credit: customers flagged credit_allowed may tender Credit; cash/card
-- collections are recorded on customer_credit_settlement (Paid order tagged credit-settlement).

DEFINE FIELD IF NOT EXISTS credit_allowed ON customer TYPE none | bool | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS credit_limit ON customer TYPE none | float | null PERMISSIONS FULL;

DEFINE TABLE IF NOT EXISTS customer_credit_settlement TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS customer ON customer_credit_settlement TYPE record<customer> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS order ON customer_credit_settlement TYPE none | record<order> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS amount ON customer_credit_settlement TYPE float PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS payment_type ON customer_credit_settlement TYPE record<payment_type> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_by ON customer_credit_settlement TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON customer_credit_settlement TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS comments ON customer_credit_settlement TYPE none | string | null PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS customer_credit_settlement_customer ON customer_credit_settlement FIELDS customer;

DEFINE TABLE IF NOT EXISTS _schema_migration TYPE NORMAL SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON _schema_migration TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_migration TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS note ON _schema_migration TYPE option<string> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS _schema_migration_name ON _schema_migration FIELDS name UNIQUE;

IF array::len(SELECT name FROM _schema_migration WHERE name = 'customer_credit') = 0 {
  CREATE _schema_migration SET
    name = 'customer_credit',
    note = 'customer.credit_allowed / credit_limit + customer_credit_settlement';
};
