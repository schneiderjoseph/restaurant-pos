import {Tables} from "@/api/db/tables.ts";
import {formatOrderNumber} from "@/lib/order.ts";
import {keyOf, linkOf} from "@/lib/order-split.ts";

type LineageDb = {
  query: <R extends unknown[] = any[]>(sql: string, parameters?: Record<string, unknown>) => Promise<R>;
};

type OrderRef = {id?: unknown, invoice_number?: number, split?: number};

/** Where an order comes from and where it went, as order numbers ("#088", "#089/1 · #090/2"). */
export type OrderLineage = {
  splitFrom?: string
  /** This order's place among the orders of its split ("1/2"). */
  splitPart?: string
  splitInto?: string
  mergedFrom?: string
  mergedInto?: string
};

const numbers = (orders: OrderRef[] = []) =>
  orders.filter(Boolean).map((order) => formatOrderNumber(order as never)).join(' · ');

/** Split and merge history of `orderIds`, keyed by "order:id". Orders with none are left out. */
export const loadOrderLineage = async (
  db: LineageDb,
  orderIds: unknown[],
): Promise<Record<string, OrderLineage>> => {
  const ids = orderIds.map(linkOf).filter(Boolean);
  if (ids.length === 0) {
    return {};
  }

  const [splits, merges] = await db.query<[
    {old?: OrderRef, news?: OrderRef[]}[],
    {merged?: OrderRef, olds?: OrderRef[]}[],
  ]>(
    `SELECT old_order.{id, invoice_number, split} AS old, new_orders.*.{id, invoice_number, split} AS news
     FROM ${Tables.order_split} WHERE old_order IN $ids OR new_orders CONTAINSANY $ids;
     SELECT new_order.{id, invoice_number, split} AS merged, old_orders.*.{id, invoice_number, split} AS olds
     FROM ${Tables.order_merge} WHERE new_order IN $ids OR old_orders CONTAINSANY $ids;`,
    {ids},
  );

  const wanted = new Set(ids.map(keyOf));
  const lineage: Record<string, OrderLineage> = {};
  const set = (order: OrderRef | undefined, patch: OrderLineage) => {
    const key = keyOf(order?.id);
    if (key && wanted.has(key)) {
      lineage[key] = {...lineage[key], ...patch};
    }
  };

  for (const split of splits ?? []) {
    set(split.old, {splitInto: numbers(split.news)});
    const siblings = (split.news ?? []).filter(Boolean);
    siblings.forEach((child, index) => {
      set(child, {splitFrom: numbers([split.old!]), splitPart: `${index + 1}/${siblings.length}`});
    });
  }
  for (const merge of merges ?? []) {
    set(merge.merged, {mergedFrom: numbers(merge.olds)});
    for (const source of merge.olds ?? []) {
      set(source, {mergedInto: numbers([merge.merged!])});
    }
  }

  return lineage;
};
