import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { MIN_PHONE_DIGITS } from '@/lib/customer-phone.ts';
import { phoneDigits } from '@/lib/guest.ts';

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Visible tail of an ID number; the rest is never shown. */
const VISIBLE_ID_CHARS = 4;
const MASK = '••••';

/**
 * Stored form of an ID document number (CIN, NIF, passport…): letters and digits only,
 * uppercased, so "003-456-789-0" and "0034567890" are the same document.
 */
export function normalizeIdDocument(value?: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/** "••••7890": an ID number is never displayed in full. */
export function maskIdDocument(value?: string | null): string {
  const normalized = normalizeIdDocument(value);
  if (!normalized) {
    return '';
  }
  return normalized.length <= VISIBLE_ID_CHARS
    ? MASK
    : `${MASK}${normalized.slice(-VISIBLE_ID_CHARS)}`;
}

/** A walk-in is registered only with a usable phone number or an ID document number. */
export function hasWalkInContact(contact: { phone?: string | null; idDocument?: string | null }): boolean {
  return (
    phoneDigits(contact.phone).length >= MIN_PHONE_DIGITS ||
    normalizeIdDocument(contact.idDocument).length > 0
  );
}

/** Existing customer holding this ID document number, so registering it again re-selects them. */
export async function findCustomerByIdDocument(
  db: AnyDb,
  idDocument?: string | null,
): Promise<Customer | undefined> {
  const number = normalizeIdDocument(idDocument);
  if (!number) {
    return undefined;
  }

  const result = await db.query(
    `SELECT * FROM ${Tables.customers} WHERE id_document_number = $number LIMIT 1`,
    { number },
  );
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows[0] as Customer | undefined) : undefined;
}
