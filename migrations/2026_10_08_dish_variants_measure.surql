-- Dishes sold in several formats or by measure, set on the dish in Manage > Dishes:
--   variants: [{ name, price }], e.g. Bottle 3500 / Shot 250. The POS asks which one.
--   measure_unit: free unit ("once", "lb"). Set = the POS asks how much; the line costs
--     quantity × the dish price (the price per unit).
--   measure_step: smallest quantity the server can enter (0.5 = half units). NONE = 0.5.
-- On the order line (order_item), copied at the sale:
--   variant: what the line shows after the dish name ("Shot", "3,5 once").
--   measure_quantity: the quantity sold by measure (3.5), for reports.
-- Both tables are SCHEMAFULL: apply before deploying the SPA, or saving a dish with
-- variants, or selling one, fails. Idempotent.

DEFINE FIELD IF NOT EXISTS variants ON menu_item TYPE none | null | array<{ name: string, price: float }> PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS measure_unit ON menu_item TYPE none | null | string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS measure_step ON menu_item TYPE none | null | float PERMISSIONS FULL;

DEFINE FIELD IF NOT EXISTS variant ON order_item TYPE none | null | string PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS measure_quantity ON order_item TYPE none | null | float PERMISSIONS FULL;
