import {RecordId} from "surrealdb";
import {DiscountType} from "@/api/model/discount.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import {Tables} from "@/api/db/tables.ts";
import {asRecordArray} from "@/lib/order.ts";
import {generateNextInvoiceNumber, getNextAutoId} from "@/lib/invoice.ts";
import {keyOf, linkOf, newRecordId} from "@/lib/order-split.ts";

type MergeDb = {
  query: <R extends unknown[] = any[]>(sql: string, parameters?: Record<string, unknown>) => Promise<R>;
};

/** Thrown when an order to merge was paid, edited, split or merged while the merge was prepared. */
export class MergeConflictError extends Error {
  constructor() {
    super('merge:changed');
  }
}

type MergeSource = Order & {
  order_discounts?: unknown[];
};

const sum = (orders: MergeSource[], pick: (order: MergeSource) => unknown) =>
  orders.reduce((total, order) => total + Number(pick(order) ?? 0), 0);

/**
 * Service charge or tip of the merged order. Percent rates apply to the merged lines, so the
 * first rate is kept; once any order has a fixed amount, the amounts are added up instead.
 */
const mergedCharge = (
  orders: MergeSource[],
  rateOf: (order: MergeSource) => unknown,
  typeOf: (order: MergeSource) => unknown,
  amountOf: (order: MergeSource) => unknown,
) => {
  const charged = orders.filter((order) => Number(rateOf(order) ?? 0) > 0);
  if (charged.length === 0) {
    return {rate: 0, type: DiscountType.Percent, amount: 0};
  }
  if (charged.some((order) => typeOf(order) === DiscountType.Fixed)) {
    const amount = sum(charged, amountOf);
    return {rate: amount, type: DiscountType.Fixed, amount};
  }
  return {rate: Number(rateOf(charged[0])), type: DiscountType.Percent, amount: sum(charged, amountOf)};
};

/**
 * Merge `orderIds` into one new order at `table`, in a single transaction: lines, payments
 * already taken, discounts, coupon and extras all move to the new order, or nothing changes.
 * The orders are read fresh here; one that changes before the commit refuses the merge.
 */
export const commitMerge = async (
  db: MergeDb,
  {orderIds, table, user}: {orderIds: unknown[], table: {id: unknown, floor?: unknown}, user?: unknown},
) => {
  const ids = orderIds.map((id) => linkOf(id)!);
  const [loaded] = await db.query<[MergeSource[]]>(
    `SELECT * FROM $orders FETCH coupon, extras`,
    {orders: ids},
  );
  // Keep the order the cashier picked them in: the first one leads (type, server).
  const orders = ids
    .map((id) => (loaded ?? []).find((order) => keyOf(order.id) === keyOf(id)))
    .filter((order): order is MergeSource => !!order);
  if (orders.length !== ids.length || orders.some((order) => order.status !== OrderStatus["In Progress"])) {
    throw new MergeConflictError();
  }

  const [lead] = orders;
  const mergedId = newRecordId(Tables.orders);
  const params: Record<string, unknown> = {};
  let paramIndex = 0;
  const bind = (value: unknown) => {
    const name = `p${paramIndex++}`;
    params[name] = value;
    return `$${name}`;
  };
  const statements: string[] = [];
  const createdAt = new Date();

  // Nothing may change on the orders between this read and the commit.
  for (const order of orders) {
    const known = bind(asRecordArray(order.items).map(linkOf));
    const payments = bind(asRecordArray(order.payments).map(linkOf));
    statements.push(`LET $o = (SELECT status, items, payments FROM ONLY ${bind(linkOf(order.id))});
      IF $o.status != '${OrderStatus["In Progress"]}'
        OR array::len(array::complement($o.items ?? [], ${known})) > 0
        OR array::len(array::complement($o.payments ?? [], ${payments})) > 0 { THROW 'merge:changed' };`);
  }

  const items = orders.flatMap((order) => asRecordArray(order.items).map(linkOf)).filter(Boolean) as RecordId[];
  const payments = orders.flatMap((order) => asRecordArray(order.payments).map(linkOf)).filter(Boolean) as RecordId[];
  const discounts = orders.flatMap((order) => asRecordArray(order.order_discounts).map(linkOf)).filter(Boolean) as RecordId[];

  // One coupon per order: the first one carries the coupon discounts of all.
  const coupons = orders.map((order) => order.coupon).filter((coupon) => coupon?.id);
  const couponId = coupons.length > 0 ? linkOf(coupons[0]!.id) : undefined;
  if (couponId && coupons.length > 1) {
    statements.push(`UPDATE ${bind(couponId)} SET discount = ${bind(sum(orders, (order) => order.coupon?.discount))};`);
  }

  // Extras are charged once per order: keep each extra once.
  const extrasByName = new Map<string, RecordId>();
  for (const extra of orders.flatMap((order) => order.extras ?? [])) {
    if (extra?.id && !extrasByName.has(extra.name)) {
      extrasByName.set(extra.name, linkOf(extra.id)!);
    }
  }

  // The guest stays only when the orders agree on one.
  const customers = [...new Set(orders.map((order) => keyOf(order.customer)).filter(Boolean))];
  const serviceCharge = mergedCharge(orders, (o) => o.service_charge, (o) => o.service_charge_type, (o) => o.service_charge_amount);
  const tip = mergedCharge(orders, (o) => o.tip, (o) => o.tip_type, (o) => o.tip_amount);
  const dueAt = orders.map((order) => order.due_at).filter(Boolean)
    .sort((a, b) => new Date(String(a)).getTime() - new Date(String(b)).getTime())[0];
  const discountAmount = sum(orders, (order) => order.discount_amount);

  const [invoiceNumber, autoId] = [await generateNextInvoiceNumber(db), await getNextAutoId(db)];

  statements.push(`CREATE ${bind(mergedId)} CONTENT ${bind({
    floor: linkOf(table.floor) ?? linkOf(lead.floor),
    table: linkOf(table.id),
    order_type: linkOf(lead.order_type),
    user: linkOf(lead.user),
    ...(customers.length === 1 ? {customer: linkOf(customers[0])} : {}),
    ...(dueAt ? {due_at: dueAt} : {}),
    ...(lead.tax ? {tax: linkOf(lead.tax)} : {}),
    excluded_taxes: (lead.excluded_taxes ?? []).map(linkOf).filter(Boolean),
    covers: sum(orders, (order) => order.covers) || 1,
    tags: [OrderStatus.Merged],
    status: OrderStatus["In Progress"],
    auto_id: autoId,
    invoice_number: invoiceNumber,
    items,
    payments,
    order_discounts: discounts,
    discount_amount: discountAmount,
    ...(discountAmount > 0 ? {
      discount: linkOf(orders.find((order) => order.discount)?.discount) ?? null,
      discount_rate: lead.discount_rate ?? 0,
    } : {}),
    ...(couponId ? {coupon: couponId} : {}),
    extras: [...extrasByName.values()],
    service_charge: serviceCharge.rate,
    service_charge_type: serviceCharge.type,
    service_charge_amount: serviceCharge.amount,
    tip: tip.rate,
    tip_type: tip.type,
    tip_amount: tip.amount,
    created_at: createdAt,
  })};`);

  if (items.length > 0) {
    statements.push(`UPDATE ${bind(items)} SET order = ${bind(mergedId)};`);
  }
  if (discounts.length > 0) {
    statements.push(`UPDATE ${bind(discounts)} SET order = ${bind(mergedId)};`);
  }
  for (const order of orders) {
    statements.push(`UPDATE ${bind(linkOf(order.id))} MERGE ${bind({
      status: OrderStatus.Merged,
      items: [],
      payments: [],
      order_discounts: [],
      coupon: null,
      extras: [],
      tags: [...(order.tags || []), OrderStatus.Merged],
    })};`);
  }
  statements.push(`CREATE ${bind(newRecordId(Tables.order_merge))} CONTENT ${bind({
    created_at: createdAt,
    created_by: linkOf(user) ?? null,
    new_order: mergedId,
    old_orders: orders.map((order) => linkOf(order.id)),
    old_items: Object.fromEntries(orders.map((order) => [
      keyOf(order.id), asRecordArray(order.items).map(keyOf),
    ])),
    new_items: {[mergedId.toString()]: items.map(keyOf)},
  })};`);

  try {
    await db.query(`BEGIN TRANSACTION;
      ${statements.join('\n      ')}
      COMMIT TRANSACTION;`, params);
  } catch (error) {
    // The driver reports a failed transaction without the THROW text: read the orders back.
    const [current] = await db.query<[{id: unknown, status?: string, items?: unknown[], payments?: unknown[]}[]]>(
      `SELECT id, status, items, payments FROM $orders`,
      {orders: ids},
    ).catch(() => [undefined]);
    // A read that fails too says nothing about the orders: report the original error.
    const changed = current !== undefined && orders.some((order) => {
      const now = (current ?? []).find((row) => keyOf(row.id) === keyOf(order.id));
      const knownItems = new Set(asRecordArray(order.items).map(keyOf));
      const knownPayments = new Set(asRecordArray(order.payments).map(keyOf));
      return !now || now.status !== OrderStatus["In Progress"]
        || (now.items ?? []).some((id) => !knownItems.has(keyOf(id)))
        || (now.payments ?? []).some((id) => !knownPayments.has(keyOf(id)));
    });
    throw changed ? new MergeConflictError() : error;
  }

  return {id: mergedId, invoiceNumber};
};
