import { Extra } from '@/api/model/extra.ts';
import { Tables } from '@/api/db/tables.ts';
import { toRecordId } from '@/lib/utils.ts';

/**
 * Extras that apply as soon as the order is taken, from its type or table (room service:
 * "En chambre" adds "Service chambre"), shown in the cart footer like the taxes and saved on
 * the order when it is sent, so the pre-bill carries them. Extras tied to a payment type or to
 * delivery are only known at payment: the payment screen keeps adding those.
 */
export interface AutoExtraContext {
  orderTypeId?: string | null;
  tableId?: string | null;
}

const ids = (records?: Array<{ id?: unknown } | unknown> | null): Set<string> =>
  new Set((records ?? []).map((record: any) => String(record?.id ?? record ?? '')).filter(Boolean));

/** Settled when the order is taken: no payment-type or delivery rule, and some rule at all. */
export const isOrderTimeExtra = (extra: Extra): boolean => {
  if ((extra.payment_types?.length ?? 0) > 0 || extra.delivery) {
    return false;
  }
  return !!extra.apply_to_all || (extra.order_types?.length ?? 0) > 0 || (extra.tables?.length ?? 0) > 0;
};

/** Same rules as the payment screen, for the extras settled when the order is taken. */
export const extraAppliesToOrder = (extra: Extra, context: AutoExtraContext): boolean => {
  if (!isOrderTimeExtra(extra)) {
    return false;
  }
  if (extra.apply_to_all) {
    return true;
  }
  if ((extra.order_types?.length ?? 0) > 0) {
    if (!context.orderTypeId || !ids(extra.order_types).has(String(context.orderTypeId))) {
      return false;
    }
  }
  if ((extra.tables?.length ?? 0) > 0) {
    if (!context.tableId || !ids(extra.tables).has(String(context.tableId))) {
      return false;
    }
  }
  return true;
};

/** The extras the order takes now, as the payment screen names and prices them. */
export const orderAutoExtras = (
  extras: Extra[] | undefined | null,
  context: AutoExtraContext,
): Array<{ name: string; value: number }> =>
  (extras ?? [])
    .filter((extra) => extraAppliesToOrder(extra, context))
    .map((extra) => ({ name: extra.name, value: Number(extra.value || 0) }));

/**
 * After the order is saved: adds the order-time extras it lacks and removes those its type or
 * table no longer calls for (switched from "En chambre" to "Sur place"). Extras added at payment
 * or by hand, whose names match no order-time extra, are left alone.
 */
export const syncOrderAutoExtras = async (db: any, orderId: unknown, context: AutoExtraContext): Promise<void> => {
  const orderRef = toRecordId(String(orderId));
  const [catalog]: [Extra[]] = await db.query(
    `SELECT * FROM ${Tables.extras} FETCH order_types, tables, payment_types`,
  );
  const managed = (catalog ?? []).filter(isOrderTimeExtra);
  if (managed.length === 0) {
    return;
  }
  const managedNames = new Set(managed.map((extra) => extra.name));
  const wanted = orderAutoExtras(managed, context);
  const wantedNames = new Set(wanted.map((extra) => extra.name));

  const [stored]: [Array<{ id: unknown; name: string } | null> | null] = await db.query(
    `SELECT VALUE extras FROM ONLY $order FETCH extras`,
    { order: orderRef },
  );
  const current = (stored ?? []).filter((extra): extra is { id: unknown; name: string } => !!extra);

  const kept = current.filter((extra) => !managedNames.has(extra.name) || wantedNames.has(extra.name));
  const removed = current.filter((extra) => !kept.includes(extra));
  const have = new Set(kept.map((extra) => extra.name));
  const added = wanted.filter((extra) => !have.has(extra.name));
  if (removed.length === 0 && added.length === 0) {
    return;
  }

  const created: unknown[] = [];
  for (const extra of added) {
    const [record] = await db.create(Tables.order_extras, { name: extra.name, value: extra.value });
    created.push(record.id);
  }
  await db.merge(orderRef, { extras: [...kept.map((extra) => extra.id), ...created] });
  for (const extra of removed) {
    try {
      await db.delete(extra.id);
    } catch {
      // Already gone: the order no longer points at it either way.
    }
  }
};
