import { Tables } from '@/api/db/tables.ts';

type QueryDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<any>;
};

/** `SELECT VALUE items` rows (one array per order, holes possible) as one flat list of ids. */
export const flattenOrderItemIds = (rows: unknown): unknown[] =>
  (Array.isArray(rows) ? rows : [])
    .flatMap((items) => (Array.isArray(items) ? items : []))
    .filter((item) => item != null);

/**
 * Items of the orders taken before `startDate` and wanted on or after it (`order.due_at`).
 * The day screens filter on `created_at >= startDate`; without these, an order taken the day
 * before for today leaves the order display and the kitchen display at midnight.
 * Returned as ids so kitchen rows are looked up through the `order_item` index.
 * A failure leaves the screens as they were (today's orders only) rather than empty.
 */
export const fetchDueOrderItemIds = async (db: QueryDb, startDate: unknown): Promise<unknown[]> => {
  try {
    const [rows] = await db.query(
      `SELECT VALUE items FROM ${Tables.orders}
       WHERE due_at >= $startDate AND created_at < $startDate`,
      { startDate }
    );
    return flattenOrderItemIds(rows);
  } catch (error) {
    console.error('Due orders lookup failed', error);
    return [];
  }
};
