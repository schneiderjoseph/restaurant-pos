-- When a ready order was handed to the guest (tap on its tile on the order display). It
-- leaves the Ready column until the kitchen finishes something new for it. NONE = not yet.
-- order is SCHEMAFULL: apply before deploying the SPA, or marking an order served fails.

DEFINE FIELD IF NOT EXISTS served_at ON order TYPE none | datetime | null PERMISSIONS FULL;
