import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { MIN_PHONE_DIGITS as PHONE_MIN_DIGITS, toE164 } from '@/lib/phone.ts';

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Shortest number treated as a real phone when checking for an existing client. */
export const MIN_PHONE_DIGITS = PHONE_MIN_DIGITS;

/**
 * Active customers with this phone number, compared on the canonical form
 * (customer.phone_e164), so "3747-3889" and "+509 3747 3889" are the same number.
 * A phone may be shared (a family, a company): every holder is returned, the caller decides.
 */
export async function findCustomersByPhone(
  db: AnyDb,
  phone?: string | null,
  options: { withLastOrder?: boolean } = {},
): Promise<Customer[]> {
  const e164 = toE164(phone);
  if (!e164) {
    return [];
  }

  // Inline (not LAST_ORDER_AT from customer.service): that module imports this one.
  const lastOrderAt = options.withLastOrder
    ? `, (SELECT VALUE created_at FROM ${Tables.orders}
         WHERE customer = $parent.id ORDER BY created_at DESC LIMIT 1)[0] AS last_order_at`
    : '';
  const result = await db.query(
    `SELECT *${lastOrderAt} FROM ${Tables.customers}
     WHERE phone_e164 = $e164 AND ${ACTIVE_CUSTOMER}
     ORDER BY number
     LIMIT 20`,
    { e164 },
  );
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows as Customer[]) : [];
}
