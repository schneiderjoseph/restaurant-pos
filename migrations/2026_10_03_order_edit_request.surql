-- Changes to order lines already sent, asked for by a user whose role does not hold
-- order_edit.sent_items. A holder of that permission accepts or refuses the request on their
-- own terminal; the order lines are written only when it is approved
-- (src/lib/order-edit-request.ts).
--   status      pending | approved | rejected | expired (order no longer open)
--   changes     one entry per line: void or update, with the values to write once approved
-- No role is given order_edit.sent_items here: it is ticked per role in the role editor.
-- Idempotent.

DEFINE TABLE IF NOT EXISTS order_edit_request TYPE NORMAL SCHEMALESS PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS order ON order_edit_request TYPE record<order> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS requested_by ON order_edit_request TYPE record<user> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS status ON order_edit_request TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON order_edit_request TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS decided_by ON order_edit_request TYPE option<record<user>> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS decided_at ON order_edit_request TYPE option<datetime> PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS order_edit_request_status ON order_edit_request FIELDS status;
