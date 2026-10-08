import { Tables } from '@/api/db/tables.ts';
import { kitchenReadyItemIds, kitchenReadyOrderIds } from '@/lib/order-display.ts';

type Db = {
  query: (sql: string, vars?: Record<string, unknown>) => Promise<unknown[]>
};

export type KitchenReadiness = {
  /** Orders the kitchen is done with ("order:id"). */
  readyOrders: Set<string>;
  /** Lines the kitchen is done with ("order_item:id"). */
  readyItems: Set<string>;
};

export const NO_KITCHEN_READINESS: KitchenReadiness = { readyOrders: new Set(), readyItems: new Set() };

/**
 * What the kitchen is done with among these order lines (all the lines of the orders asked
 * about). Looked up by order item (indexed), so the query does not scan every kitchen row
 * ever made. Lines re-created by a split by amount follow the original line's kitchen rows.
 */
export const fetchKitchenReadiness = async (db: Db, itemIds: unknown[]): Promise<KitchenReadiness> => {
  if (itemIds.length === 0) {
    return NO_KITCHEN_READINESS;
  }
  const [itemRows, , kitchenRows] = await db.query(
    `SELECT id, order, deleted_at, is_refunded, is_suspended, split_source FROM ${Tables.order_items}
     WHERE id IN $items;
     LET $sources = array::filter((SELECT VALUE split_source FROM ${Tables.order_items} WHERE id IN $items), |$v| $v != NONE AND $v != NULL);
     SELECT status, order_item, order_item.order AS order, order_item.deleted_at AS deleted_at,
     order_item.is_suspended AS is_suspended FROM ${Tables.order_items_kitchen}
     WHERE order_item IN array::concat($items, $sources)`,
    { items: itemIds }
  );
  const items = Array.isArray(itemRows) ? itemRows : [];
  const rows = Array.isArray(kitchenRows) ? kitchenRows : [];
  const readyOrders = kitchenReadyOrderIds(items, rows);
  return { readyOrders, readyItems: kitchenReadyItemIds(items, rows, readyOrders) };
};
