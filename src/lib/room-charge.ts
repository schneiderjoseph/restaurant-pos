import type { DateTime as LuxonDateTime } from 'luxon';
import type { Customer } from '@/api/model/customer.ts';
import type { PaymentType } from '@/api/model/payment_type.ts';
import type { Stay } from '@/api/model/stay.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { isAsiGuest } from '@/lib/guest.ts';
import { toRecordId } from '@/lib/utils.ts';
import { RecordId, StringRecordId } from 'surrealdb';

/** `payment_type.type` of the tender that puts the bill on the guest's room. */
export const ROOM_PAYMENT_TYPE = 'Room';

/**
 * asi-sync polls FrontDesk every 30 s. Past this age the stay can no longer be trusted:
 * the guest may have checked out since, so the room cannot be charged.
 */
export const ROOM_SYNC_MAX_AGE_MS = 5 * 60 * 1000;

export type RoomChargeRefusal =
  /** Walk-in, local client or no client: there is no stay to charge. */
  | 'not-hotel-guest'
  /** The ASI FrontDesk stay is closed: the guest pays directly, like a walk-in. */
  | 'checked-out'
  /** A manual POS stay is closed: the guest pays directly. */
  | 'manual-stay-closed'
  /** The last FrontDesk sync is too old to know whether the stay is still open. */
  | 'sync-stale';

/** One shape, not a union: the project compiles without strictNullChecks, which union narrowing needs. */
export type RoomChargeCheck = {
  ok: boolean;
  /** Set when `ok` is false. */
  reason?: RoomChargeRefusal;
  /** Set when `ok` is true. */
  departsToday?: boolean;
  /** Open manual stay id when Room is allowed for a POS stay. */
  stayId?: unknown;
};

export function isRoomPaymentType(paymentType?: { type?: PaymentType['type'] } | null): boolean {
  // Case-insensitive like isRemotePaymentType: imports may store the type in lower case.
  return String(paymentType?.type ?? '').toLowerCase() === ROOM_PAYMENT_TYPE.toLowerCase();
}

/**
 * The stay reference held by customer.current_stay: a RecordId / StringRecordId as is, or the
 * id of a fetched stay. Never `.id` of a RecordId: that is the key without its table
 * ("abc" instead of stay:abc), which order_payment.stay (record<stay>) refuses.
 */
export const stayIdOf = (value: unknown): unknown => {
  if (value == null || value === '') return undefined;
  if (value instanceof RecordId || value instanceof StringRecordId) return value;
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && 'id' in value) {
    return stayIdOf((value as { id: unknown }).id);
  }
  return value;
};

/**
 * Whether this order can be put on the guest's room. A room is never charged, a stay is:
 * - ASI: customer:asi_fd_* still open as of a recent sync
 * - Manual: local/walk-in with an open POS stay (customer.current_stay)
 */
export function checkRoomCharge(
  customer: Pick<
    Customer,
    'source' | 'in_house' | 'asi_synced_at' | 'asi_date_out' | 'asi_checkin_id' | 'asi_guest_id' | 'current_stay' | 'tags'
  > | null | undefined,
  now: LuxonDateTime,
  options?: { stayDateOut?: string | null },
): RoomChargeCheck {
  if (!customer) {
    return { ok: false, reason: 'not-hotel-guest' };
  }

  if (isAsiGuest(customer) || customer.source === 'asi-fd') {
    if (customer.in_house !== true) {
      return { ok: false, reason: 'checked-out' };
    }
    if (!customer.asi_synced_at) {
      return { ok: false, reason: 'sync-stale' };
    }
    const syncedAt = toLuxonDateTime(customer.asi_synced_at);
    if (!syncedAt.isValid || now.toMillis() - syncedAt.toMillis() > ROOM_SYNC_MAX_AGE_MS) {
      return { ok: false, reason: 'sync-stale' };
    }
    return { ok: true, departsToday: customer.asi_date_out === now.toISODate() };
  }

  // Manual POS stay: never an ASI id on the customer.
  if (customer.asi_checkin_id != null || customer.asi_guest_id != null) {
    return { ok: false, reason: 'not-hotel-guest' };
  }

  const stayId = stayIdOf(customer.current_stay);
  if (stayId != null && customer.in_house === true) {
    return {
      ok: true,
      departsToday: options?.stayDateOut != null && options.stayDateOut === now.toISODate(),
      stayId,
    };
  }

  if (
    customer.in_house !== true
    && (Boolean(customer.tags?.includes('checked-out')) || Boolean(customer.tags?.includes('manual-stay')))
  ) {
    return { ok: false, reason: 'manual-stay-closed' };
  }

  return { ok: false, reason: 'not-hotel-guest' };
}

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Order's customer as stored right now — never the copy held by the screen. */
export async function loadCustomerForRoomCharge(
  db: AnyDb,
  customer: unknown,
): Promise<Customer | undefined> {
  // A fetched customer carries its RecordId in `.id`; a bare RecordId or StringRecordId is
  // the reference itself — a RecordId's own `.id` is the key without its table.
  const isReference =
    typeof customer === 'string' ||
    customer instanceof RecordId ||
    customer instanceof StringRecordId;
  const id = isReference ? customer : (customer as { id?: unknown } | null | undefined)?.id;
  if (id == null || id === '') {
    return undefined;
  }
  const result = await db.query('SELECT * FROM $id', { id: toRecordId(id) });
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows[0] as Customer | undefined) : undefined;
}

/** Load open stay date_out for departsToday on manual Room charges. */
export async function loadStayDateOutForRoomCharge(
  db: AnyDb,
  stayId: unknown,
): Promise<string | null> {
  if (stayId == null || stayId === '') return null;
  const result = await db.query('SELECT date_out, status FROM $id', { id: toRecordId(stayId) });
  const rows = Array.isArray(result) ? result[0] : undefined;
  const stay = Array.isArray(rows) ? (rows[0] as Stay | undefined) : undefined;
  if (!stay || stay.status !== 'open') return null;
  return stay.date_out ?? null;
}
