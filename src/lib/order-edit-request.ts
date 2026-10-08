import type { CartModifierGroup, MenuItem } from '@/api/model/cart_item.ts';
import type { OrderItem } from '@/api/model/order_item.ts';
import { OrderStatus } from '@/api/model/order.ts';
import { OrderVoidReason } from '@/api/model/order_void.ts';
import { Tables } from '@/api/db/tables.ts';
import {
  OrderEditRequest,
  OrderEditRequestStatus,
  SentLineChange,
} from '@/api/model/order_edit_request.ts';
import { buildOrderItemPayload, sumNormalizedModifierTree } from '@/lib/order-item-pricing.ts';
import { lineDisplayName } from '@/lib/dish-selling.ts';
import { syncOrderTaxes } from '@/lib/order-tax.service.ts';
import { cancelItemStages } from '@/lib/kitchen/workflow.service.ts';
import { recordKey } from '@/lib/kitchen/routing.ts';
import { toRecordId } from '@/lib/utils.ts';
import { orderIdToString } from '@/store/order-edit-session.ts';

/**
 * Role permission: this user changes a line that was already sent (quantity, removal, comment,
 * options) directly, with no approval.
 */
export const EDIT_SENT_ITEMS_MODULE = 'order_edit.sent_items';

/** Role permission: this user receives the change requests of others and accepts or refuses them. */
export const APPROVE_SENT_ITEMS_EDIT_MODULE = 'order_edit.approve';

/** How a user changes sent lines: directly, or as a request an approver decides. */
export type SentItemsEditMode = 'direct' | 'request';

export const sentItemsEditMode = (can: (module: string) => boolean): SentItemsEditMode =>
  can(EDIT_SENT_ITEMS_MODULE) ? 'direct' : 'request';

/** Below this, two unit prices are the same (float noise from tax-inclusive conversion). */
const PRICE_EPSILON = 0.005;

/** The changes that wait for an approver: only those taking money off the order. */
export const changesNeedingApproval = (changes: readonly SentLineChange[]): SentLineChange[] =>
  changes.filter((change) => change.lowers_total);

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<any>;
};

/** `table:id` of a record, whether it came fetched (`{ id, … }`) or as a bare record id. */
export const refKey = (value: unknown): string => {
  const key = recordKey(value);
  return key && key !== '[object Object]' ? key : recordKey((value as { id?: unknown })?.id);
};

const sameModifiers = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Surreal rejects an `undefined` value: keep only the fields that hold one. */
const withoutUndefined = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/**
 * What the cart changed on the lines the order already holds: a line that is gone or struck
 * out is a void, a different quantity, comment or option set is an update. New lines are not
 * changes to sent lines.
 */
export const diffSentLines = (
  originals: readonly OrderItem[] | null | undefined,
  cart: readonly MenuItem[],
): SentLineChange[] => {
  const byId = new Map(cart.map((item) => [orderIdToString(item.id), item]));
  const changes: SentLineChange[] = [];

  for (const orig of originals ?? []) {
    if (!orig || orig.deleted_at) {
      continue;
    }
    const id = orderIdToString(orig.id);
    const cur = byId.get(id);
    const base = {
      order_item: id,
      name: lineDisplayName(orig.item?.name, orig.variant),
      from_quantity: Number(orig.quantity),
    };

    if (!cur || cur.deleted_at) {
      changes.push({ ...base, action: 'void', quantity: Number(orig.quantity), lowers_total: true });
      continue;
    }

    const quantityChanged = Number(cur.quantity) !== Number(orig.quantity);
    const commentsChanged = (cur.comments || '') !== (orig.comments || '');
    const modifiersChanged = !sameModifiers(cur.selectedGroups, orig.modifiers);
    if (!quantityChanged && !commentsChanged && !modifiersChanged) {
      continue;
    }

    const pricing = buildOrderItemPayload(cur);
    const sentUnit =
      Number(orig.price || 0) + sumNormalizedModifierTree(orig.modifiers as CartModifierGroup[]);
    const newUnit = pricing.price + sumNormalizedModifierTree(pricing.modifiers);
    changes.push({
      ...base,
      action: 'update',
      quantity: Number(cur.quantity),
      lowers_total:
        Number(cur.quantity) < Number(orig.quantity) || newUnit < sentUnit - PRICE_EPSILON,
      comments_changed: commentsChanged,
      comments: cur.comments || '',
      modifiers_changed: modifiersChanged,
      patch: withoutUndefined({
        quantity: cur.quantity,
        comments: cur.comments,
        modifiers: pricing.modifiers,
        price: pricing.price,
        tax: pricing.tax,
        tax_mode: pricing.tax_mode,
      }),
    });
  }

  return changes;
};

/** Removes a sent line: struck out, its kitchen work cancelled, and a void kept for the reports. */
export const voidSentLine = async (
  db: AnyDb,
  args: { orderId: unknown; itemId: string; quantity: number; deletedBy?: unknown; loggedInUser?: unknown },
): Promise<void> => {
  const itemRef = toRecordId(args.itemId);
  await db.query(`UPDATE ${itemRef} SET deleted_at = time::now()`);
  await cancelItemStages(db as any, args.itemId);
  if (!args.deletedBy) {
    return;
  }
  try {
    await db.query(
      `CREATE ${Tables.order_voids} CONTENT {
         comments: 'POS order edit',
         created_at: time::now(),
         deleted_by: $deletedBy,
         logged_in_user: $loggedInUser,
         order: $order,
         quantity: $quantity,
         reason: $reason,
         items: [$item]
       }`,
      {
        deletedBy: toRecordId(args.deletedBy),
        loggedInUser: toRecordId(args.loggedInUser ?? args.deletedBy),
        order: toRecordId(args.orderId),
        quantity: args.quantity,
        reason: OrderVoidReason.PunchByMistake,
        item: itemRef,
      },
    );
  } catch (error) {
    console.error('Failed to record void for edited line', error);
  }
};

export const createOrderEditRequest = async (
  db: AnyDb,
  args: { orderId: unknown; requestedBy: unknown; changes: SentLineChange[] },
): Promise<void> => {
  await db.query(
    `CREATE ${Tables.order_edit_requests} CONTENT {
       order: $order,
       requested_by: $requestedBy,
       status: $status,
       changes: $changes,
       created_at: time::now()
     }`,
    {
      order: toRecordId(args.orderId),
      requestedBy: toRecordId(args.requestedBy),
      status: OrderEditRequestStatus.pending,
      changes: args.changes,
    },
  );
};

export const fetchPendingOrderEditRequests = async (db: AnyDb): Promise<OrderEditRequest[]> => {
  const [rows] = await db.query(
    `SELECT * FROM ${Tables.order_edit_requests}
     WHERE status = $status
     ORDER BY created_at ASC
     FETCH order, order.table, requested_by`,
    { status: OrderEditRequestStatus.pending },
  );
  return Array.isArray(rows) ? (rows as OrderEditRequest[]) : [];
};

/** Moves a pending request to `status`; false when someone else decided it first. */
const claimRequest = async (
  db: AnyDb,
  requestId: unknown,
  status: OrderEditRequestStatus,
  decidedBy: unknown,
): Promise<boolean> => {
  const [rows] = await db.query(
    `UPDATE ${toRecordId(refKey(requestId))}
     SET status = $status, decided_by = $decidedBy, decided_at = time::now()
     WHERE status = $pending
     RETURN AFTER`,
    {
      status,
      decidedBy: toRecordId(decidedBy),
      pending: OrderEditRequestStatus.pending,
    },
  );
  return Array.isArray(rows) && rows.length > 0;
};

export type OrderEditDecision = 'approved' | 'rejected' | 'expired' | 'taken';

export type OrderEditApproval = {
  decision: OrderEditDecision;
  /** The changes actually written, for the kitchen tickets. */
  applied: SentLineChange[];
};

export const rejectOrderEditRequest = async (
  db: AnyDb,
  request: Pick<OrderEditRequest, 'id'>,
  decidedBy: unknown,
): Promise<OrderEditDecision> =>
  (await claimRequest(db, request.id, OrderEditRequestStatus.rejected, decidedBy)) ? 'rejected' : 'taken';

/**
 * Applies a request to its order. The order must still be open, else the request expires
 * untouched. The request is claimed before any write so two approvers cannot apply it twice;
 * if a write fails it goes back to pending (each change is safe to apply again).
 */
export const approveOrderEditRequest = async (
  db: AnyDb,
  request: Pick<OrderEditRequest, 'id' | 'order' | 'requested_by' | 'changes'>,
  decidedBy: unknown,
): Promise<OrderEditApproval> => {
  const orderId = refKey(request.order);
  const orderRef = toRecordId(orderId);
  const requestRef = toRecordId(refKey(request.id));

  const [orders] = await db.query(`SELECT id, status FROM ${orderRef}`);
  if (orders?.[0]?.status !== OrderStatus['In Progress']) {
    const expired = await claimRequest(db, request.id, OrderEditRequestStatus.expired, decidedBy);
    return { decision: expired ? 'expired' : 'taken', applied: [] };
  }

  if (!(await claimRequest(db, request.id, OrderEditRequestStatus.approved, decidedBy))) {
    return { decision: 'taken', applied: [] };
  }

  try {
    const requestedBy = refKey(request.requested_by);
    const voided: unknown[] = [];
    const applied: SentLineChange[] = [];

    for (const change of request.changes ?? []) {
      const itemRef = toRecordId(change.order_item);
      const [lines] = await db.query(`SELECT id, deleted_at FROM ${itemRef}`);
      // Already removed since the request was made: nothing left to change.
      if (!lines?.[0] || lines[0].deleted_at) {
        continue;
      }

      if (change.action === 'void') {
        await voidSentLine(db, {
          orderId,
          itemId: change.order_item,
          quantity: change.quantity,
          deletedBy: requestedBy,
          loggedInUser: decidedBy,
        });
        voided.push(itemRef);
        applied.push(change);
      } else if (change.patch) {
        await db.query(
          `UPDATE ${itemRef} MERGE $patch; UPDATE ${itemRef} SET updated_at = time::now();`,
          { patch: change.patch },
        );
        applied.push(change);
      }
    }

    await db.query(
      `UPDATE ${orderRef} SET items = array::complement(items ?? [], $voided), updated_at = time::now()`,
      { voided },
    );
    await syncOrderTaxes(db as any, orderRef);
    return { decision: 'approved', applied };
  } catch (error) {
    await db
      .query(
        `UPDATE ${requestRef} SET status = $pending, decided_by = NONE, decided_at = NONE`,
        { pending: OrderEditRequestStatus.pending },
      )
      .catch(() => undefined);
    throw error;
  }
};
