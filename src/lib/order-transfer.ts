import { OrderStatus } from '@/api/model/order.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { entityAfterWrite } from '@/integrations/events/publish/entity.ts';
import { sameCustomer } from '@/lib/customer.service.ts';
import { syncOrderTaxes, type DbClient } from '@/lib/order-tax.service.ts';
import { getCustomerTaxExemptionIds, getExcludedTaxIds } from '@/lib/tax-calculator.ts';
import { postOrderTracking } from '@/lib/tracking.service.ts';
import { toRecordId } from '@/lib/utils.ts';

/** ok: moved. same: already on that customer. changed: paid, cancelled or moved meanwhile. */
export type OrderTransferResult = 'ok' | 'same' | 'changed';

interface StoredOrder {
  status?: string;
  customer?: unknown;
  customer_name?: string | null;
  from_exemptions?: unknown[] | null;
  excluded_taxes?: unknown[] | null;
}

const rowsOf = <T>(result: unknown): T[] => {
  const first = Array.isArray(result) ? result[0] : undefined;
  if (Array.isArray(first)) return first as T[];
  return first ? [first as T] : [];
};

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Moves an unpaid order to another customer file. One conditional write: it only lands
 * while the order is still in progress and still on the customer it was read with, so a
 * payment or another transfer in between is never overwritten. The taxes the old customer
 * was exempt from come back, the new customer's exemptions are taken off, and the move is
 * traced (from → to).
 */
export async function transferOrderToCustomer(
  db: DbClient,
  orderId: unknown,
  customer: Pick<Customer, 'id' | 'name' | 'guest_code' | 'tax_exemptions'>,
  trace: {
    module: string;
    page?: string;
    user?: (NonNullable<Parameters<typeof postOrderTracking>[0]['user']> & { id?: unknown }) | null;
  },
): Promise<OrderTransferResult> {
  const order = toRecordId(orderId);
  const to = toRecordId(customer.id);

  const [stored] = rowsOf<StoredOrder>(await db.query(
    `SELECT status, customer, customer.name AS customer_name,
            customer.tax_exemptions AS from_exemptions, excluded_taxes
     FROM ONLY $order`,
    { order },
  ));
  if (!stored || stored.status !== OrderStatus['In Progress']) return 'changed';
  if (sameCustomer(stored.customer, customer.id)) return 'same';

  const before = getExcludedTaxIds(stored);
  const excluded = new Set(before);
  for (const id of getCustomerTaxExemptionIds({ tax_exemptions: stored.from_exemptions })) excluded.delete(id);
  for (const id of getCustomerTaxExemptionIds(customer)) excluded.add(id);

  const from = stored.customer ? toRecordId(String(stored.customer)) : undefined;
  const updated = rowsOf(await db.query(
    `UPDATE $order SET customer = $to, excluded_taxes = $excluded, updated_at = time::now()
     WHERE status = $status AND ${from ? 'customer = $from' : '(customer = NONE OR customer = NULL)'}
     RETURN id`,
    {
      order,
      to,
      // Never pass undefined: Surreal rejects it.
      ...(from ? { from } : {}),
      status: OrderStatus['In Progress'],
      excluded: [...excluded].map((id) => toRecordId(id)),
    },
  ));
  if (updated.length === 0) return 'changed';

  if (!sameSet(before, excluded)) {
    await syncOrderTaxes(db, order);
  }

  const fromId = from ? String(from) : null;
  postOrderTracking({
    module: trace.module,
    page: trace.page,
    orderId: order,
    payload: {
      from_customer: fromId,
      from_name: stored.customer_name ?? null,
      to_customer: String(to),
      to_name: customer.name || customer.guest_code || null,
    },
    user: trace.user ?? undefined,
  });
  await entityAfterWrite({
    domain: 'pos',
    table: Tables.orders,
    entityId: String(order),
    action: 'update',
    before: { customer: fromId },
    after: { customer: String(to) },
    source: 'order-transfer',
    changedBy: trace.user?.id ? String(trace.user.id) : undefined,
  }).catch((error) => console.error('Order transfer event failed', error));

  return 'ok';
}
