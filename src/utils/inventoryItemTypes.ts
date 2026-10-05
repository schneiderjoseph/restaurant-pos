/**
 * Inventory module UI was removed; dish recipes may still reference inventory_item rows.
 * Accept any non-deleted item shape that still exists in the DB.
 */
export const canUseInDishRecipe = (item: { deleted_at?: unknown } | null | undefined): boolean =>
  item != null && item.deleted_at == null;
