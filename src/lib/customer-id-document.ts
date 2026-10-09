import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { isPlaceholderPhone, MIN_PHONE_DIGITS } from '@/lib/phone.ts';
import { phoneDigits, placeholderGuestName } from '@/lib/guest.ts';

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

/**
 * A walk-in is registered only with a usable phone number or an ID document number.
 * A made-up phone ("0000 0000", "1234 5678") is no phone.
 */
export function hasWalkInContact(contact: { phone?: string | null; idDocument?: string | null }): boolean {
  return (
    (phoneDigits(contact.phone).length >= MIN_PHONE_DIGITS && !isPlaceholderPhone(contact.phone)) ||
    normalizeIdDocument(contact.idDocument).length > 0
  );
}

/**
 * Why this walk-in cannot be registered, as a message key; null when it can.
 * "Cash", "Client"… go on an order with no customer, "Ch-21" on the room's guest.
 */
export function walkInRefusal(walkIn: {
  name?: string | null;
  phone?: string | null;
  idDocument?: string | null;
}): string | null {
  const placeholder = placeholderGuestName(walkIn.name);
  if (placeholder === 'anonymous') {
    return 'menu:guest.anonymousName';
  }
  if (placeholder === 'room') {
    return 'menu:guest.roomAsName';
  }
  if (hasWalkInContact(walkIn)) {
    return null;
  }
  return isPlaceholderPhone(walkIn.phone) ? 'menu:guest.fakePhone' : 'menu:guest.contactRequired';
}

/** Kinds of ID document a walk-in may show. */
export const ID_DOCUMENT_TYPES = ['cin', 'nif', 'passport', 'license', 'other'] as const;
export type IdDocumentType = (typeof ID_DOCUMENT_TYPES)[number];

/**
 * Active customer holding this ID document number, so registering it again re-selects them.
 * The ID identifies one person: the database refuses a second active holder.
 * With `includeDeleted`, a deleted or merged holder is found too (to offer restoring it).
 */
export async function findCustomerByIdDocument(
  db: AnyDb,
  idDocument?: string | null,
  options: { includeDeleted?: boolean } = {},
): Promise<Customer | undefined> {
  const number = normalizeIdDocument(idDocument);
  if (!number) {
    return undefined;
  }

  const result = await db.query(
    `SELECT * FROM ${Tables.customers}
     WHERE id_document_number = $number${options.includeDeleted ? '' : ` AND ${ACTIVE_CUSTOMER}`}
     ORDER BY deleted_at, number
     LIMIT 1`,
    { number },
  );
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows[0] as Customer | undefined) : undefined;
}
