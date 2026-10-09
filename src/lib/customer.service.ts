import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { User } from '@/api/model/user.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { normalizeIdDocument } from '@/lib/customer-id-document.ts';
import { findCustomersByPhone } from '@/lib/customer-phone.ts';
import { formatPersonName, namesAreSamePerson } from '@/lib/guest.ts';
import { toRecordId } from '@/lib/utils.ts';

export type CustomerMatchReason = 'phone' | 'name';

export interface CustomerMatch {
  customer: Customer;
  reasons: CustomerMatchReason[];
}

export { ACTIVE_CUSTOMER };

/**
 * Customer records: who a customer is, and the only ways they change.
 *
 * A customer is identified by its record id, its number (C-000123), its phone and its ID
 * document: never by its name, two clients may share one. A phone may be shared too; an ID
 * document belongs to one active customer (UNIQUE customer.id_document_key in the database).
 * Nothing is ever deleted: a removed customer gets deleted_at, a duplicate gets merged_into,
 * and both can be restored (migrations/2026_10_06_customer_management.surql).
 */

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Thrown when the ID document is already held by another active customer. */
export class CustomerIdDocumentTakenError extends Error {
  constructor(readonly holder?: Customer) {
    super('ID document already held by another customer');
    this.name = 'CustomerIdDocumentTakenError';
  }
}

const rowsOf = <T>(result: unknown): T[] => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? (first as T[]) : [];
};

/** "customer:abc" from a string, a RecordId, or a fetched record (plain object with an id). */
const idOf = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && 'id' in value) {
    return idOf((value as { id: unknown }).id);
  }
  return String(value);
};

/** Same customer record, whatever form the ids come in (string, RecordId, fetched object). */
export const sameCustomer = (a: unknown, b: unknown): boolean => {
  const left = idOf(a);
  return Boolean(left) && left === idOf(b);
};

/** "C-000123", or '' before the customer got a number. */
export function customerNumberLabel(customer?: Pick<Customer, 'number'> | null): string {
  const number = customer?.number;
  return typeof number === 'number' && Number.isFinite(number)
    ? `C-${String(number).padStart(6, '0')}`
    : '';
}

/** 123 from "C-000123", "c123" or "C 123"; null for anything else. */
export function parseCustomerNumber(text?: string | null): number | null {
  const match = /^\s*c[\s-]*0*(\d{1,9})\s*$/i.exec(String(text ?? ''));
  return match ? Number(match[1]) : null;
}

export const isCustomerDeleted =(customer?: Pick<Customer, 'deleted_at' | 'merged_into'> | null): boolean =>
  Boolean(customer?.deleted_at || customer?.merged_into);

/** Trimmed, de-duplicated (case-insensitive), empty entries dropped. */
export function cleanList(values?: readonly (string | null | undefined)[] | null): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const text = String(value ?? '').trim().replace(/\s+/g, ' ');
    const key = text.toLowerCase();
    if (text && !seen.has(key)) {
      seen.add(key);
      out.push(text);
    }
  }
  return out;
}

/** True when the database refused a write because the ID document key is taken. */
export const isIdDocumentConflict = (error: unknown): boolean =>
  /customer_id_document_key/.test(error instanceof Error ? error.message : String(error));

const userRef = (user?: Pick<User, 'id'> | null) => (user?.id ? toRecordId(user.id) : null);

export interface WalkInInput {
  name: string;
  guestCode: string;
  /** Stored international form ("+509 3747 3889"), or empty. */
  phone?: string | null;
  idDocument?: string | null;
  idDocumentType?: string | null;
  createdBy?: Pick<User, 'id'> | null;
}

/** Registers a walk-in. The database gives it its customer number. */
export async function createWalkInCustomer(db: AnyDb, input: WalkInInput): Promise<Customer> {
  const idDocument = normalizeIdDocument(input.idDocument);
  const content: Record<string, unknown> = {
    name: formatPersonName(input.name),
    guest_code: input.guestCode,
    room: null,
    in_house: false,
    source: 'walk-in',
    tags: ['walk-in'],
    phone: input.phone?.trim() || null,
    created_at: new Date(),
    created_by: userRef(input.createdBy),
  };
  if (idDocument) {
    content.id_document_number = idDocument;
    content.id_document_type = input.idDocumentType || null;
  }

  try {
    const [created] = rowsOf<Customer>(
      await db.query(`CREATE ${Tables.customers} CONTENT $content`, { content }),
    );
    if (!created) {
      throw new Error('Customer not created');
    }
    return created;
  } catch (error) {
    if (isIdDocumentConflict(error)) {
      throw new CustomerIdDocumentTakenError();
    }
    throw error;
  }
}

/** Fields anyone may change through updateCustomer; the rest has dedicated functions. */
export type CustomerPatch = Partial<Pick<Customer,
  | 'name' | 'phone' | 'email' | 'id_document_number' | 'id_document_type'
  | 'notes' | 'allergies' | 'dietary' | 'seating_pref' | 'language' | 'birthday'
  | 'vip' | 'marketing_consent' | 'tags'
>>;

/** Applies a change and returns the stored customer. Lists are cleaned, the ID normalized. */
export async function updateCustomer(
  db: AnyDb,
  id: unknown,
  patch: CustomerPatch,
  user?: Pick<User, 'id'> | null,
): Promise<Customer> {
  const data: Record<string, unknown> = { ...patch };
  if ('name' in patch) data.name = formatPersonName(patch.name);
  if ('phone' in patch) data.phone = String(patch.phone ?? '').trim() || null;
  if ('id_document_number' in patch) data.id_document_number = normalizeIdDocument(patch.id_document_number) || null;
  if ('allergies' in patch) data.allergies = cleanList(patch.allergies);
  if ('dietary' in patch) data.dietary = cleanList(patch.dietary);
  if ('tags' in patch) data.tags = cleanList(patch.tags);
  for (const key of ['notes', 'seating_pref', 'language', 'birthday', 'email'] as const) {
    if (key in patch) data[key] = String(patch[key] ?? '').trim() || null;
  }
  data.updated_at = new Date();
  data.updated_by = userRef(user);

  try {
    const result = await db.query(`UPDATE ONLY $id MERGE $data RETURN AFTER`, {
      id: toRecordId(idOf(id)),
      data,
    });
    const updated = Array.isArray(result) ? (result[0] as Customer | undefined) : undefined;
    if (!updated) {
      throw new Error('Customer not updated');
    }
    return updated;
  } catch (error) {
    if (isIdDocumentConflict(error)) {
      throw new CustomerIdDocumentTakenError();
    }
    throw error;
  }
}

/**
 * Taxes this customer does not pay. Kept out of updateCustomer: only a role that may
 * remove taxes (orders.apply_tax) sets them, the form checks it.
 */
export async function setCustomerTaxExemptions(
  db: AnyDb,
  id: unknown,
  taxIds: string[],
  user?: Pick<User, 'id'> | null,
): Promise<Customer> {
  const result = await db.query(
    `UPDATE ONLY $id SET tax_exemptions = $taxes, updated_at = time::now(), updated_by = $user RETURN AFTER`,
    {
      id: toRecordId(idOf(id)),
      taxes: [...new Set(taxIds)].map((taxId) => toRecordId(taxId)),
      user: userRef(user),
    },
  );
  const updated = Array.isArray(result) ? (result[0] as Customer | undefined) : undefined;
  if (!updated) {
    throw new Error('Customer not updated');
  }
  return updated;
}

/** Soft delete: the customer leaves every list; its orders keep pointing at it. */
export async function softDeleteCustomer(
  db: AnyDb,
  id: unknown,
  options: { reason?: string | null; user?: Pick<User, 'id'> | null } = {},
): Promise<void> {
  await db.query(
    `UPDATE $id SET deleted_at = time::now(), deleted_by = $user, deleted_reason = $reason`,
    {
      id: toRecordId(idOf(id)),
      user: userRef(options.user),
      reason: options.reason?.trim() || null,
    },
  );
}

/**
 * Brings back a deleted or merged customer. Fails with CustomerIdDocumentTakenError when
 * another active customer holds its ID document meanwhile.
 */
export async function restoreCustomer(
  db: AnyDb,
  id: unknown,
  user?: Pick<User, 'id'> | null,
): Promise<void> {
  try {
    await db.query(
      `UPDATE $id SET deleted_at = NONE, deleted_by = NONE, deleted_reason = NONE, merged_into = NONE,
         updated_at = time::now(), updated_by = $user`,
      { id: toRecordId(idOf(id)), user: userRef(user) },
    );
  } catch (error) {
    if (isIdDocumentConflict(error)) {
      throw new CustomerIdDocumentTakenError();
    }
    throw error;
  }
}

/**
 * What the kept customer takes from the duplicate: missing contact details, the union of
 * lists, both notes. The kept customer's own values win.
 */
export function mergedCustomerFields(keep: Customer, drop: Customer): Record<string, unknown> {
  const fill = <K extends keyof Customer>(key: K) => {
    const own = keep[key];
    const empty = own == null || (typeof own === 'string' && own.trim() === '');
    return empty && drop[key] != null && String(drop[key]).trim() !== '' ? drop[key] : undefined;
  };
  const patch: Record<string, unknown> = {};
  for (const key of ['phone', 'email', 'id_document_number', 'id_document_type', 'seating_pref', 'language', 'birthday'] as const) {
    const value = fill(key);
    if (value !== undefined) patch[key] = value;
  }
  // The ID document comes over with its type, never a type alone.
  if (patch.id_document_number === undefined) delete patch.id_document_type;

  const notes = cleanList([keep.notes, drop.notes]);
  if (notes.length > 1) patch.notes = notes.join('\n');
  else if (!keep.notes?.trim() && notes[0]) patch.notes = notes[0];

  for (const key of ['allergies', 'dietary', 'tags'] as const) {
    const union = cleanList([...(keep[key] ?? []), ...(drop[key] ?? [])]);
    if (union.length !== cleanList(keep[key]).length) patch[key] = union;
  }
  if (!keep.vip && drop.vip) patch.vip = true;
  return patch;
}

/**
 * Folds a duplicate into the kept customer, in one transaction: the duplicate is marked
 * merged (soft-deleted, its orders stay on it and show with the kept customer), the kept one
 * takes its missing details, and duplicates previously folded into it follow.
 */
export async function mergeCustomers(
  db: AnyDb,
  keep: Customer,
  drop: Customer,
  user?: Pick<User, 'id'> | null,
): Promise<void> {
  if (sameCustomer(keep.id, drop.id)) {
    throw new Error('Cannot merge a customer into itself');
  }
  const patch = mergedCustomerFields(keep, drop);
  try {
    await db.query(
      `BEGIN TRANSACTION;
       UPDATE $drop SET merged_into = $keep, deleted_at = time::now(), deleted_by = $user,
         deleted_reason = $reason;
       UPDATE ${Tables.customers} SET merged_into = $keep WHERE merged_into = $drop;
       UPDATE $keep MERGE $patch;
       COMMIT TRANSACTION;`,
      {
        keep: toRecordId(idOf(keep.id)),
        drop: toRecordId(idOf(drop.id)),
        user: userRef(user),
        reason: 'merged',
        patch: { ...patch, updated_at: new Date(), updated_by: userRef(user) },
      },
    );
  } catch (error) {
    if (isIdDocumentConflict(error)) {
      throw new CustomerIdDocumentTakenError();
    }
    throw error;
  }
}

/** The customer and the duplicates merged into it: whose orders make up its history. */
export async function customerHistoryIds(db: AnyDb, id: unknown): Promise<unknown[]> {
  const record = toRecordId(idOf(id));
  const merged = rowsOf<unknown>(
    await db.query(`SELECT VALUE id FROM ${Tables.customers} WHERE merged_into = $id`, { id: record }),
  );
  return [record, ...merged];
}

/** Projection: created_at of the customer's latest order, to tell homonyms apart. */
export const LAST_ORDER_AT = `(SELECT VALUE created_at FROM ${Tables.orders}
  WHERE customer = $parent.id ORDER BY created_at DESC LIMIT 1)[0] AS last_order_at`;

/** Active customers carrying the same name, words in any order ("Michel John" ≈ "John Michel"). */
export async function findHomonyms(db: AnyDb, name: string): Promise<Customer[]> {
  const tokens = name.toLowerCase().split(/\s+/).filter(Boolean);
  const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
  if (!longest) {
    return [];
  }
  const rows = rowsOf<Customer>(
    await db.query(
      `SELECT *, ${LAST_ORDER_AT} FROM ${Tables.customers}
       WHERE ${ACTIVE_CUSTOMER} AND string::contains(string::lowercase(name ?? ''), $word)
       LIMIT 200`,
      { word: longest },
    ),
  );
  return rows.filter((customer) => namesAreSamePerson(customer.name, name));
}

/**
 * Known customers a new walk-in may be: same phone, or same name. Neither proves it is the
 * same person, so staff choose (CustomerMatchesModal). A same ID document is the same
 * person: the caller re-selects that customer before getting here.
 */
export async function findWalkInMatches(
  db: AnyDb,
  input: { name: string; phone?: string | null },
): Promise<CustomerMatch[]> {
  const [byPhone, byName] = await Promise.all([
    input.phone ? findCustomersByPhone(db, input.phone, { withLastOrder: true }) : Promise.resolve([]),
    findHomonyms(db, input.name),
  ]);
  const matches = new Map<string, CustomerMatch>();
  const add = (customer: Customer, reason: CustomerMatchReason) => {
    const key = idOf(customer.id);
    const entry = matches.get(key) ?? { customer, reasons: [] };
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
    matches.set(key, entry);
  };
  byPhone.forEach((customer) => add(customer, 'phone'));
  byName.forEach((customer) => add(customer, 'name'));
  // Both reasons first, then same phone, then same name.
  const rank = (match: CustomerMatch) => (match.reasons.length > 1 ? 0 : match.reasons[0] === 'phone' ? 1 : 2);
  return [...matches.values()].sort((a, b) => rank(a) - rank(b));
}

/**
 * Who may change a customer's name, phone and ID document: a manager
 * (admin.customers.update), or the server who registered this walk-in.
 * Hotel (ASI) guests come from the front desk and are never edited here.
 */
export function canEditCustomerIdentity(
  customer: Pick<Customer, 'source' | 'tags' | 'created_by' | 'asi_guest_id' | 'asi_checkin_id'> | undefined | null,
  user: Pick<User, 'id'> | undefined | null,
  can: (module: string) => boolean,
): boolean {
  if (!customer) return false;
  if (customer.asi_guest_id != null || customer.asi_checkin_id != null || customer.source === 'asi-fd') {
    return false;
  }
  if (can('admin.customers.update')) return true;
  // Front Desk must not edit identity from the server guest list — only create/check-in
  // flows on /frontdesk write name/phone/ID for new walk-ins.
  const walkIn = customer.source === 'walk-in' || Boolean(customer.tags?.includes('walk-in'));
  return walkIn && Boolean(user?.id) && sameCustomer(customer.created_by, user?.id);
}
