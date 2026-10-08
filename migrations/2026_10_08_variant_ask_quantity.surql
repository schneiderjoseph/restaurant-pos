-- A dish variant can ask how many (shots: 1, 2, 3...): after picking it, the POS shows the
-- number pad and the cart line takes that quantity at the variant's price.
--   variants[*].ask_quantity: true = ask. NONE / false = one unit, as before.
-- menu_item is SCHEMAFULL: apply before saving a dish with this option. Idempotent.

DEFINE FIELD OVERWRITE variants ON menu_item
  TYPE none | null | array<{ name: string, price: float, ask_quantity: none | bool }> PERMISSIONS FULL;
