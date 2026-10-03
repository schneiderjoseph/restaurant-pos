-- When the guest wants the order: set by the server at order time, printed on the kitchen
-- ticket. NONE / NULL means "as soon as possible". order is SCHEMAFULL: apply before
-- deploying the SPA, or saving an order fails.

DEFINE FIELD IF NOT EXISTS due_at ON order TYPE none | datetime | null PERMISSIONS FULL;
