-- Sold by measure, the quantity pad's presets, set on the dish in Manage > Dishes:
--   measure_default: the quantity the pad opens with (12 oz). NONE = empty.
--   measure_bump: how much the + / − buttons add or take (4 oz). NONE = the smallest step.
-- menu_item is SCHEMAFULL: apply before saving a dish with these presets. Idempotent.

DEFINE FIELD IF NOT EXISTS measure_default ON menu_item TYPE none | null | float PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS measure_bump ON menu_item TYPE none | null | float PERMISSIONS FULL;
