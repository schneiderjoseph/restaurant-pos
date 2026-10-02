-- ID document number on a customer (CIN, NIF, passport…).
-- A walk-in is registered with a phone or this number; it is stored normalized
-- (letters and digits, uppercased) and matched on registration to re-select a
-- known client. customer is SCHEMAFULL, so the field must exist.

DEFINE FIELD IF NOT EXISTS id_document_number ON customer TYPE none | string | null PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS customer_id_document_number ON customer FIELDS id_document_number;
