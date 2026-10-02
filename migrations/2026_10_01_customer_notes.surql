-- Free-text staff note on a customer (preferences, allergies, VIP…).
-- Shown in the guest lookup panel; asi-sync copies it to a guest's next stay
-- (matched on asi_guest_id). customer is SCHEMAFULL, so the field must exist.

DEFINE FIELD IF NOT EXISTS notes ON customer TYPE none | string | null PERMISSIONS FULL;
