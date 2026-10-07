-- Included sides: a dish takes N choices of a group for free, the next ones are charged.
-- On the dish ↔ group link (menu_item_modifier_group), per dish:
--   included_modifiers: choices given free. NONE / 0 = the group works as before.
--   max_modifiers: the most choices allowed when included_modifiers is set. NONE / 0 = no limit.
-- On the group (modifier_group), shared by every dish:
--   free_modifier_rule: which choices are free when they don't cost the same:
--     'first' (the first ones picked), 'cheapest', 'most_expensive'. NONE = 'first'.
--   extra_modifier_price: one price for every paid choice. NONE = each choice's own price.
-- Both tables are SCHEMAFULL: apply before deploying the SPA, or saving a dish or a group
-- from Manage fails. Idempotent.

DEFINE FIELD IF NOT EXISTS included_modifiers ON menu_item_modifier_group TYPE none | int | null PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS max_modifiers ON menu_item_modifier_group TYPE none | int | null PERMISSIONS FULL;

DEFINE FIELD IF NOT EXISTS free_modifier_rule ON modifier_group TYPE none | null | string
  ASSERT $value = NONE OR $value = NULL OR $value INSIDE ['first', 'cheapest', 'most_expensive']
  PERMISSIONS FULL;
DEFINE FIELD IF NOT EXISTS extra_modifier_price ON modifier_group TYPE none | float | null PERMISSIONS FULL;
