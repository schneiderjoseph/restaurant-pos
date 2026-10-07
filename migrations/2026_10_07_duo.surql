-- Duo: two servers working together for the day (src/lib/duo.ts). The inviter picks a
-- signed-in colleague, who accepts on their terminal. While it runs, each sees and changes the
-- other's orders and both hear an order the kitchen finishes. It ends at the end of the latest
-- service of the two (Manage → Services) + 2 h, after an announcement on both terminals that
-- ends it within 10 s unless someone extends it by 1 h.
--   status      pending | active | declined | cancelled | ended
-- order.duo: the duo that worked the order. Its lines count for whichever of the two added
-- them (order_item.created_by) and its tip is split by those sales in the reports.
-- order is SCHEMAFULL: apply before deploying the SPA, or saving an order fails. Idempotent.

DEFINE TABLE IF NOT EXISTS duo TYPE NORMAL SCHEMALESS PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS inviter ON duo TYPE record<user> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS partner ON duo TYPE record<user> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS status ON duo TYPE string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS created_at ON duo TYPE datetime DEFAULT time::now() PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS accepted_at ON duo TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS ends_at ON duo TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS ended_at ON duo TYPE none | datetime | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS ended_by ON duo TYPE none | record<user> | null PERMISSIONS FULL;
DEFINE INDEX IF NOT EXISTS duo_status ON duo FIELDS status;

DEFINE FIELD IF NOT EXISTS duo ON order TYPE none | record<duo> | null PERMISSIONS FULL;
