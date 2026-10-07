import {RecordId} from "surrealdb";
import {customAlphabet} from "nanoid";
import {DiscountType} from "@/api/model/discount.ts";
import {Order, OrderStatus} from "@/api/model/order.ts";
import {OrderItem} from "@/api/model/order_item.ts";
import {Tables} from "@/api/db/tables.ts";
import {toRecordId} from "@/lib/utils.ts";
import {asRecordArray} from "@/lib/order.ts";
import {calculateOrderItemPrice} from "@/lib/cart.ts";
import {generateNextInvoiceNumber, getNextAutoId} from "@/lib/invoice.ts";
import {allocateProportionally} from "@/lib/discount-engine/rounding.ts";

type SplitDb = {
  query: <R extends unknown[] = any[]>(sql: string, parameters?: Record<string, unknown>) => Promise<R>;
};

/** Record link for a fetched record, a bare record id or a string id; undefined when unset. */
export const linkOf = (value: unknown): RecordId | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof RecordId) {
    return value;
  }
  if (typeof value === 'object' && 'id' in value) {
    return linkOf((value as {id: unknown}).id);
  }
  return toRecordId(value);
};

/** A field typed `record | string`: a record link, or a plain string kept as it is. */
export const linkOrText = (value: unknown) =>
  typeof value === 'string' && !value.includes(':') ? value : linkOf(value);

export const keyOf = (value: unknown) => linkOf(value)?.toString() ?? '';

/** Payments already taken on the order: splitting would drop them from every new order. */
export const orderHasPayments = (order: Order) =>
  asRecordArray(order.payments).some((payment) => payment != null);

/**
 * Held lines are not offered for splitting, yet the split empties the original order:
 * they go to the first split order instead of being orphaned.
 */
export const heldOrderItems = (order: Order): OrderItem[] =>
  asRecordArray<OrderItem>(order.items)
    .filter((item) => item?.is_suspended === true && item?.deleted_at == null);

/** Order extras total. The payment screen re-applies extras in full, so they stay on the first split. */
export const orderExtrasTotal = (order: Order) =>
  (order.extras ?? []).reduce((sum, extra) => sum + Number(extra?.value || 0), 0);

/** Covers shared out so the splits add up to the original count (each split seats at least one). */
const splitCovers = (order: Order, splitCount: number, index: number) => {
  const covers = Math.max(0, Math.floor(Number(order.covers ?? 0)));
  const share = Math.floor(covers / splitCount) + (index < covers % splitCount ? 1 : 0);
  return Math.max(1, share);
};

/**
 * Fields every split order inherits from the order being split. Room-service and
 * takeaway orders have no table, so none of the links may be assumed present.
 */
const splitOrderBase = (order: Order, splitCount: number, index: number) => {
  const links = {
    floor: linkOf(order.floor),
    table: linkOf(order.table),
    order_type: linkOf(order.order_type),
    user: linkOf(order.user),
    customer: linkOf(order.customer),
    // Tax is computed from each split's own lines with the order's tax settings.
    tax: linkOf(order.tax),
  };

  return {
    ...Object.fromEntries(Object.entries(links).filter(([, value]) => value !== undefined)),
    ...(order.due_at ? {due_at: order.due_at} : {}),
    excluded_taxes: (order.excluded_taxes ?? []).map(linkOf).filter(Boolean),
    covers: splitCovers(order, splitCount, index),
  };
};

/**
 * Order-level amounts for a split holding `ratio` of the order. A percent rate applies to
 * the split's own lines as is; a fixed amount is shared out by the ratio.
 */
const splitOrderAmounts = (order: Order, share: (total: number) => number) => {
  const serviceChargeFixed = order.service_charge_type === DiscountType.Fixed;
  const tipFixed = order.tip_type === DiscountType.Fixed;
  const serviceCharge = Number(order.service_charge ?? 0);
  const tip = Number(order.tip ?? 0);

  return {
    service_charge: serviceChargeFixed ? share(serviceCharge) : serviceCharge,
    service_charge_type: serviceChargeFixed ? DiscountType.Fixed : DiscountType.Percent,
    service_charge_amount: share(Number(order.service_charge_amount ?? 0)),
    tip: tipFixed ? share(tip) : tip,
    tip_type: tipFixed ? DiscountType.Fixed : DiscountType.Percent,
    tip_amount: share(Number(order.tip_amount ?? 0)),
  };
};

/** Line subtotal of the order lines offered for splitting. */
export const linesSubtotal = (items: OrderItem[]) =>
  items.reduce((sum, item) => sum + calculateOrderItemPrice(item), 0);

/** Share of the order a split carries when it takes `lines` out of `allLines`. */
export const linesRatio = (lines: OrderItem[], allLines: OrderItem[], splitCount: number) => {
  const total = linesSubtotal(allLines);
  return total > 0 ? linesSubtotal(lines) / total : 1 / Math.max(1, splitCount);
};

/** Translation key (orders namespace) for a failed split. */
export const splitErrorKey = (error: unknown) => {
  if (error instanceof SplitConflictError) {
    return error.reason === 'paid' ? 'split.toast.hasPayments' : 'split.toast.changed';
  }
  return 'split.toast.failed';
};

const newRecordKey = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 20);
export const newRecordId = (table: string) => new RecordId(table, newRecordKey());

/** On screen, a carved unit is a line whose id is `<source id>~<key>`. */
const PIECE_MARK = '~';
const pieceSourceOf = (line: OrderItem) => {
  const id = String(line.id);
  return id.includes(PIECE_MARK) ? id.slice(0, id.indexOf(PIECE_MARK)) : undefined;
};

/** A line of several units can give one unit away to another split. */
export const canCarveUnit = (line: OrderItem) => !pieceSourceOf(line) && Number(line.quantity) >= 2;

/** Takes one unit off `line`: the line with one unit less, and the unit as a line of its own. */
export const carveUnit = (line: OrderItem): [OrderItem, OrderItem] => [
  {...line, quantity: Number(line.quantity) - 1},
  {...line, id: `${String(line.id)}${PIECE_MARK}${newRecordKey()}`, quantity: 1},
];

/** A split's lines as commitSplit takes them: whole lines moved, carved units copied. */
export const partLines = (lines: OrderItem[]): Pick<SplitPart, 'itemIds' | 'pieces'> => ({
  itemIds: lines.filter((line) => !pieceSourceOf(line)).map((line) => line.id),
  pieces: lines.flatMap((line) => {
    const sourceId = pieceSourceOf(line);
    return sourceId ? [{sourceId, quantity: Number(line.quantity)}] : [];
  }),
});

export interface SplitPart {
  /** Share of the order's amounts (tax, discounts, charges, coupon) this split carries. */
  ratio: number;
  /** Existing lines moved to this split order. */
  itemIds?: unknown[];
  /** Fields written on the moved lines. */
  itemPatch?: Record<string, unknown>;
  /** Lines created for this split, each with its pre-allocated id (split by amount). */
  newItems?: {id: RecordId, data: Record<string, unknown>, sourceId: unknown}[];
  /** Units carved off a line (3 beers for 3 guests): copied into this split with its kitchen tickets. */
  pieces?: {sourceId: unknown, quantity: number}[];
  /** Fields that override the inherited ones (the split's guest). */
  fields?: Record<string, unknown>;
}

/** Thrown when the order was changed (paid, edited, split) while the split was being prepared. */
export class SplitConflictError extends Error {
  constructor(public readonly reason: 'paid' | 'changed') {
    super(`split:${reason}`);
  }
}

type OrderDiscountRow = Record<string, unknown> & {
  applied_amount?: number;
  line_allocations?: {order_item: unknown, amount: number}[];
};

/** Discount lines of the order, shared out to one split. */
const splitDiscounts = (
  rows: OrderDiscountRow[],
  part: SplitPart,
  orderId: RecordId,
  share: (total: number) => number,
  carving: {
    loaded: Map<string, number>,
    carved: Map<string, number>,
    /** Units carved into this split: their line id, source line and quantity. */
    pieces: {id: RecordId, sourceKey: string, quantity: number}[],
  },
) => {
  const movedKeys = new Set((part.itemIds ?? []).map(keyOf));
  const cloneOf = new Map((part.newItems ?? []).map((line) => [keyOf(line.sourceId), line.id]));

  return rows.flatMap((row) => {
    const allocations = Array.isArray(row.line_allocations) ? row.line_allocations : [];
    let lineAllocations: {order_item: RecordId, amount: number}[] = [];
    let applied: number;

    if (allocations.length > 0) {
      // Line discounts follow their lines; a cloned line carries its share of the amount.
      lineAllocations = allocations.flatMap((allocation) => {
        const key = keyOf(allocation.order_item);
        const amount = Number(allocation.amount || 0);
        const loaded = carving.loaded.get(key) || 1;
        // A carved line keeps the share of what is left on it; each unit carved here takes its own.
        const kept = movedKeys.has(key)
          ? [{order_item: linkOf(allocation.order_item)!, amount: amount * (loaded - (carving.carved.get(key) ?? 0)) / loaded}]
          : [];
        const carvedHere = carving.pieces
          .filter((piece) => piece.sourceKey === key)
          .map((piece) => ({order_item: piece.id, amount: amount * piece.quantity / loaded}));
        if (kept.length > 0 || carvedHere.length > 0) {
          return [...kept, ...carvedHere];
        }
        const clone = cloneOf.get(key);
        return clone ? [{order_item: clone, amount: share(Number(allocation.amount || 0))}] : [];
      });
      applied = lineAllocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    } else {
      applied = share(Number(row.applied_amount ?? 0));
    }

    if (applied <= 0) {
      return [];
    }

    const {id: _id, order: _order, order_items: _items, line_allocations: _allocations, ...rest} = row;
    return [{
      id: newRecordId(Tables.order_discounts),
      data: {
        ...rest,
        order: orderId,
        applied_amount: applied,
        base_amount: applied,
        order_items: lineAllocations.map((allocation) => allocation.order_item),
        line_allocations: lineAllocations,
      },
    }];
  });
};

/**
 * Split `order` into one new order per part, in a single transaction: either every split
 * order exists and the original is closed, or nothing changed. The transaction refuses an
 * order that was paid, edited or split since `order` was loaded.
 */
export const commitSplit = async (
  db: SplitDb,
  {order, parts, user}: {order: Order, parts: SplitPart[], user?: unknown},
) => {
  const oldOrderId = linkOf(order.id)!;
  const discountRows = (await db.query<[OrderDiscountRow[]]>(
    `SELECT * FROM ${Tables.order_discounts} WHERE order = $order AND (removed_at = NONE OR removed_at = null)`,
    {order: oldOrderId},
  ))?.[0] ?? [];

  const params: Record<string, unknown> = {
    old: oldOrderId,
    known: asRecordArray(order.items).map(linkOf).filter(Boolean),
  };
  let paramIndex = 0;
  const bind = (value: unknown) => {
    const name = `p${paramIndex++}`;
    params[name] = value;
    return `$${name}`;
  };
  const statements: string[] = [];
  const create = (id: RecordId, data: Record<string, unknown>) =>
    statements.push(`CREATE ${bind(id)} CONTENT ${bind(data)};`);

  const createdAt = new Date();
  const newOrderIds: RecordId[] = [];
  const oldItemKeys = new Set<string>();
  const newItems: Record<string, string[]> = {};
  let heldItems = heldOrderItems(order).map((item) => linkOf(item.id)!);

  const activeParts = parts.filter((part) =>
    (part.itemIds?.length ?? 0) + (part.newItems?.length ?? 0) + (part.pieces?.length ?? 0) > 0);
  const loadedItems = new Map(asRecordArray<OrderItem>(order.items).map((item) => [keyOf(item?.id), item]));
  /** Lines of each new order's first send: its original, no longer a supplement. */
  const promoted: RecordId[] = [];
  const loadedQuantity = new Map(asRecordArray<OrderItem>(order.items)
    .map((item) => [keyOf(item?.id), Number(item?.quantity ?? 0)]));
  const carvedBySource = new Map<string, {id: RecordId, carved: number}>();
  const carvedTotal = new Map<string, number>();
  for (const piece of activeParts.flatMap((part) => part.pieces ?? [])) {
    carvedTotal.set(keyOf(piece.sourceId), (carvedTotal.get(keyOf(piece.sourceId)) ?? 0) + piece.quantity);
  }

  // Amounts shared out by ratio, rounded to the cent so the splits add up to the original.
  const weights = activeParts.map((part, index) => ({id: String(index), weight: Math.max(0, part.ratio)}));
  const shareFor = (index: number) => (total: number) =>
    total === 0 ? 0 : allocateProportionally(total, weights).find((entry) => entry.id === String(index))?.amount ?? 0;

  for (const [index, part] of activeParts.entries()) {
    const orderId = newRecordId(Tables.orders);
    const share = shareFor(index);
    const movedIds = [...(part.itemIds ?? []).map((id) => linkOf(id)!), ...heldItems];
    heldItems = [];
    [...movedIds, ...(part.newItems ?? []).map((line) => line.sourceId)]
      .forEach((id) => oldItemKeys.add(keyOf(id)));

    for (const line of part.newItems ?? []) {
      create(line.id, {...line.data, order: orderId});
    }
    // Carved units: a copy of the line (and of its kitchen tickets) for the quantity taken.
    // The line's own amounts (discount, charges, tax) are shared by quantity.
    const pieceIds: RecordId[] = [];
    const pieceLines: {id: RecordId, sourceKey: string, quantity: number}[] = [];
    for (const piece of part.pieces ?? []) {
      const sourceId = linkOf(piece.sourceId)!;
      const quantity = loadedQuantity.get(keyOf(sourceId)) ?? 0;
      if (piece.quantity <= 0 || piece.quantity >= quantity) {
        throw new Error(`Cannot carve ${piece.quantity} off a line of ${quantity}`);
      }
      const pieceId = newRecordId(Tables.order_items);
      const source = bind(sourceId), loaded = bind(quantity), taken = bind(piece.quantity), copy = bind(pieceId);
      const row = `$piece${pieceIds.length}_${index}`;
      statements.push(`LET ${row} = (SELECT * OMIT id FROM ONLY ${source});`);
      statements.push(`IF ${row}.quantity != ${loaded} { THROW 'split:changed' };`);
      statements.push(`CREATE ${copy} CONTENT object::extend(${row}, {
        order: ${bind(orderId)}, quantity: ${taken},
        discount: (${row}.discount ?? 0) * ${taken} / ${loaded},
        service_charges: (${row}.service_charges ?? 0) * ${taken} / ${loaded},
        tax: (${row}.tax ?? 0) * ${taken} / ${loaded}
      });`);
      statements.push(`INSERT INTO ${Tables.order_items_kitchen} (SELECT * OMIT id FROM ${Tables.order_items_kitchen} WHERE order_item = ${source})
        .map(|$ticket| object::extend($ticket, {order_item: ${copy}}));`);
      const carved = carvedBySource.get(keyOf(sourceId)) ?? {id: sourceId, carved: 0};
      carved.carved += piece.quantity;
      carvedBySource.set(keyOf(sourceId), carved);
      oldItemKeys.add(keyOf(sourceId));
      pieceIds.push(pieceId);
      pieceLines.push({id: pieceId, sourceKey: keyOf(sourceId), quantity: piece.quantity});
    }

    // A line added after the first send is a supplement of the original order. In this new
    // order, the lines of its own first send are its original: the kitchen and the order
    // display must not show them as a supplement.
    const sent = [
      ...movedIds.map((id) => ({id, item: loadedItems.get(keyOf(id))})),
      ...pieceLines.map((piece) => ({id: piece.id, item: loadedItems.get(piece.sourceKey)})),
    ].filter(({item}) => item && !item.is_suspended && !item.deleted_at);
    if (sent.length > 0 && sent.every(({item}) => item!.is_addition)) {
      const sentAt = (item?: OrderItem) => String(item?.created_at ?? '');
      const firstSend = sent.map(({item}) => sentAt(item)).sort()[0];
      promoted.push(...sent.filter(({item}) => sentAt(item) === firstSend).map(({id}) => id));
    }

    const itemIds = [...movedIds, ...(part.newItems ?? []).map((line) => line.id), ...pieceIds];

    const extraIds: RecordId[] = [];
    if (index === 0) {
      for (const extra of order.extras ?? []) {
        if (!extra) continue;
        const extraId = newRecordId(Tables.order_extras);
        create(extraId, {name: extra.name, value: Number(extra.value || 0)});
        extraIds.push(extraId);
      }
    }

    const discounts = splitDiscounts(discountRows, part, orderId, share,
      {loaded: loadedQuantity, carved: carvedTotal, pieces: pieceLines});
    discounts.forEach((discount) => create(discount.id, discount.data));
    // Orders discounted before discount lines existed only carry the amount.
    const discountAmount = discountRows.length > 0
      ? discounts.reduce((sum, discount) => sum + Number(discount.data.applied_amount), 0)
      : share(Number(order.discount_amount ?? 0));

    let couponId: RecordId | undefined;
    const couponDiscount = share(Number(order.coupon?.discount ?? 0));
    if (order.coupon?.coupon && couponDiscount > 0) {
      couponId = newRecordId(Tables.order_coupons);
      create(couponId, {coupon: linkOf(order.coupon.coupon), discount: couponDiscount, created_at: createdAt});
    }

    const [invoiceNumber, autoId] = [await generateNextInvoiceNumber(db), await getNextAutoId(db)];

    create(orderId, {
      ...splitOrderBase(order, activeParts.length, index),
      ...splitOrderAmounts(order, share),
      ...part.fields,
      tags: [OrderStatus.Spilt],
      status: OrderStatus["In Progress"],
      auto_id: autoId,
      invoice_number: invoiceNumber,
      items: itemIds,
      extras: extraIds,
      order_discounts: discounts.map((discount) => discount.id),
      discount_amount: discountAmount,
      ...(discountAmount > 0 ? {
        discount: linkOf(order.discount) ?? null,
        discount_rate: order.discount_rate ?? 0,
      } : {}),
      ...(couponId ? {coupon: couponId} : {}),
      created_at: createdAt,
      // Empty splits are skipped: number the orders actually created, without gaps.
      split: index + 1,
    });

    if (movedIds.length > 0) {
      statements.push(`UPDATE ${bind(movedIds)} MERGE ${bind({order: orderId, ...part.itemPatch})};`);
    }

    newOrderIds.push(orderId);
    newItems[orderId.toString()] = itemIds.map((id) => id.toString());
  }

  // After every copy was made from the lines as they were.
  if (promoted.length > 0) {
    statements.push(`UPDATE ${bind(promoted)} SET is_addition = false;`);
  }

  // The carved lines keep what is left, once every copy has read them.
  for (const {id, carved} of carvedBySource.values()) {
    const loaded = loadedQuantity.get(keyOf(id)) ?? 0;
    const left = loaded - carved;
    if (left <= 0) {
      throw new Error(`Cannot carve ${carved} off a line of ${loaded}`);
    }
    statements.push(`UPDATE ${bind(id)} SET quantity = ${bind(left)},
      discount = (discount ?? 0) * ${bind(left / loaded)},
      service_charges = (service_charges ?? 0) * ${bind(left / loaded)},
      tax = (tax ?? 0) * ${bind(left / loaded)};`);
  }

  statements.push(`UPDATE $old MERGE ${bind({
    status: OrderStatus.Spilt,
    items: [],
    tags: [...(order.tags || []), OrderStatus.Spilt],
  })};`);
  create(newRecordId(Tables.order_split), {
    created_at: createdAt,
    created_by: linkOf(user) ?? null,
    old_order: oldOrderId,
    new_orders: newOrderIds,
    old_items: {[oldOrderId.toString()]: [...oldItemKeys]},
    new_items: newItems,
  });

  try {
    await db.query(`BEGIN TRANSACTION;
      LET $current = (SELECT status, items, payments FROM ONLY $old);
      IF $current.status != '${OrderStatus["In Progress"]}' { THROW 'split:changed' };
      IF array::len($current.payments ?? []) > 0 { THROW 'split:paid' };
      IF array::len(array::complement($current.items ?? [], $known)) > 0 { THROW 'split:changed' };
      ${statements.join('\n      ')}
      COMMIT TRANSACTION;`, params);
  } catch (error) {
    // The driver reports a failed transaction without the THROW text: read the order back.
    const [current] = await db.query<[{status?: string, items?: unknown[], payments?: unknown[]} | undefined]>(
      `SELECT status, items, payments FROM ONLY $old`,
      {old: oldOrderId},
    ).catch(() => [undefined]);
    if (current && (current.payments?.length ?? 0) > 0) {
      throw new SplitConflictError('paid');
    }
    const knownKeys = new Set((params.known as RecordId[]).map(keyOf));
    if (current && (current.status !== OrderStatus["In Progress"]
      || (current.items ?? []).some((id) => !knownKeys.has(keyOf(id))))) {
      throw new SplitConflictError('changed');
    }
    throw error;
  }

  return newOrderIds;
};
