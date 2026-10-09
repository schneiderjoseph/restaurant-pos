-- Service hours on a category (breakfast 06:00–10:00), set in Manage > Categories:
--   available_from / available_to: "HH:mm"; an end before the start runs past midnight.
--   room_included: during the hours, free for hotel guests (lines at 0, "Inclus chambre").
--   walkin_price: what a plate (a dish at 0) costs a walk-in, and anyone outside the hours
--     (1 690 HTG, as ASI's "PETIT DEJEUNER"). Dishes with their own price keep it.
--   package_base_items: dishes that come with the plate and stay at 0 (coffee + fruits).
-- The POS does it in the cart (src/lib/category-hours.ts); order_item gains nothing.
-- category is SCHEMAFULL: apply before saving hours in Manage. Idempotent.

DEFINE FIELD IF NOT EXISTS available_from ON category TYPE none | null | string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS available_to ON category TYPE none | null | string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS room_included ON category TYPE none | null | bool PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS walkin_price ON category TYPE none | null | float PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS package_base_items ON category TYPE none | null | array<record<menu_item>> PERMISSIONS FULL;
