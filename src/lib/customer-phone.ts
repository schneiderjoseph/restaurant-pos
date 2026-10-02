import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { phoneDigits } from '@/lib/guest.ts';

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Shortest number treated as a real phone when checking for an existing client. */
export const MIN_PHONE_DIGITS = 6;

/**
 * Existing customer with the same phone number (digits compared, formatting ignored),
 * so registering a walk-in whose number is already known re-selects that client.
 * Suffix match either way, so "3456 1234" and "+509 3456-1234" are the same number.
 */
export async function findCustomerByPhone(
  db: AnyDb,
  phone?: string | null,
): Promise<Customer | undefined> {
  const digits = phoneDigits(phone);
  if (digits.length < MIN_PHONE_DIGITS) {
    return undefined;
  }

  const result = await db.query(
    `SELECT * FROM (
       SELECT *, string::replace(type::string(phone), /[^0-9]/, '') AS phone_digits
       FROM ${Tables.customers}
       WHERE phone != NONE AND phone != NULL
     )
     WHERE string::len(phone_digits) >= $min
       AND (string::ends_with(phone_digits, $digits) OR string::ends_with($digits, phone_digits))
     LIMIT 1`,
    { digits, min: MIN_PHONE_DIGITS },
  );
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows[0] as Customer | undefined) : undefined;
}
