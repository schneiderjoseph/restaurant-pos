-- Dish descriptions, one text per language: { fr: "...", en: "...", es: "..." }.
-- Keys are the app language codes (src/lib/languages.ts). Shown on a long press of the
-- dish in the POS menu, edited in Manage > Dishes. FLEXIBLE: any language key is kept.
-- Idempotent.

DEFINE FIELD OVERWRITE description ON menu_item TYPE none | object | null FLEXIBLE PERMISSIONS FULL;
