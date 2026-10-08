import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { Stay } from '@/api/model/stay.ts';
import type { Table } from '@/api/model/table.ts';
import type { User } from '@/api/model/user.ts';
import { OrderStatus } from '@/api/model/order.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { generateNextInvoiceNumber, getNextAutoId } from '@/lib/invoice.ts';
import { isAsiGuest } from '@/lib/guest.ts';
import { normalizeRoomKey, roomKeyCandidates } from '@/lib/room-key.ts';
import { toRecordId } from '@/lib/utils.ts';

const ROOM_TYPE = 'Room';
const EXCLUDED_ORDER_STATUSES = [OrderStatus.Cancelled, OrderStatus.Refunded];
const MONEY_EPS = 0.009;
/** Transactions report their own errors (StayServiceError), never the driver's generic toast. */
const QUIET = { quiet: true } as const;

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>, options?: { quiet?: boolean }) => Promise<unknown>;
};

const rowsOf = <T>(result: unknown): T[] => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? (first as T[]) : [];
};

const idOf = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && 'id' in value) {
    return idOf((value as { id: unknown }).id);
  }
  return String(value);
};

const userRef = (user?: Pick<User, 'id'> | null) => (user?.id ? toRecordId(user.id) : null);

const isYmd = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

export class StayServiceError extends Error {
  constructor(
    readonly code:
      | 'asi_guest'
      | 'invalid_dates'
      | 'room_required'
      | 'room_occupied_asi'
      | 'room_occupied_manual'
      | 'already_in_house'
      | 'stay_not_open'
      | 'room_unsettled'
      | 'nothing_to_settle'
      | 'invalid_settle'
      | 'not_found',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'StayServiceError';
  }
}

/** ASI FrontDesk guests cannot be checked in manually — create a local client instead. */
export function assertNotAsiCustomer(
  customer: Pick<Customer, 'source' | 'asi_checkin_id' | 'asi_guest_id'> | null | undefined,
): void {
  if (!customer) return;
  if (
    isAsiGuest(customer)
    || customer.asi_checkin_id != null
    || customer.asi_guest_id != null
  ) {
    throw new StayServiceError('asi_guest', 'ASI guests cannot be checked in manually');
  }
}

export function assertStayDates(dateIn: string, dateOut: string): void {
  if (!isYmd(dateIn) || !isYmd(dateOut) || dateOut < dateIn) {
    throw new StayServiceError('invalid_dates', 'date_out must be on or after date_in');
  }
}

/** Outstanding Room folio still to collect in cash/card. */
export function stayRoomOutstanding(
  roomTotal: number,
  settledAmount?: number | null,
): number {
  const due = Math.max(0, Number(roomTotal) || 0);
  const paid = Math.max(0, Number(settledAmount) || 0);
  return Math.max(0, Math.round((due - paid) * 100) / 100);
}

export function isStayRoomSettled(
  roomTotal: number,
  settledAmount?: number | null,
): boolean {
  return stayRoomOutstanding(roomTotal, settledAmount) <= MONEY_EPS;
}

const withInHouseTag = (tags: unknown, add: boolean): string[] => {
  const list = Array.isArray(tags) ? tags.map(String) : [];
  const without = list.filter((t) => t !== 'in-house' && t !== 'checked-out');
  if (add) {
    if (!without.includes('manual-stay')) without.push('manual-stay');
    without.push('in-house');
  } else {
    if (!without.includes('manual-stay')) without.push('manual-stay');
    without.push('checked-out');
  }
  return without;
};

/** Room strings that match this physical unit (number + asi_alias + normalized forms). */
export async function collectRoomCandidates(db: AnyDb, room: string): Promise<string[]> {
  const base = roomKeyCandidates(room);
  const key = normalizeRoomKey(room);
  if (!key) return base;
  const tables = rowsOf<Table>(
    await db.query(
      `SELECT number, asi_alias FROM ${Tables.tables}
       WHERE deleted_at = none AND source = 'asi-room'`,
    ),
  );
  const extra: string[] = [];
  for (const table of tables) {
    const numKey = normalizeRoomKey(table.number);
    const aliasKey = normalizeRoomKey(table.asi_alias as string | undefined);
    if (numKey === key || aliasKey === key) {
      extra.push(...roomKeyCandidates(table.number), ...roomKeyCandidates(table.asi_alias as string | undefined));
    }
  }
  return Array.from(new Set([...base, ...extra].filter(Boolean)));
}

/** True when an ASI in-house guest occupies any of these room strings. */
export async function findAsiOccupant(
  db: AnyDb,
  roomCandidates: string[],
  exceptCustomerId?: unknown,
): Promise<Customer | undefined> {
  if (roomCandidates.length === 0) return undefined;
  const rows = rowsOf<Customer>(
    await db.query(
      `SELECT * FROM ${Tables.customers}
       WHERE ${ACTIVE_CUSTOMER}
         AND source = 'asi-fd'
         AND (in_house = true OR tags CONTAINS 'in-house')
         AND room IN $rooms`,
      { rooms: roomCandidates },
    ),
  );
  const except = idOf(exceptCustomerId);
  return rows.find((row) => idOf(row.id) !== except);
}

export interface CheckInStayInput {
  customer: Pick<Customer, 'id' | 'source' | 'asi_checkin_id' | 'asi_guest_id' | 'in_house' | 'tags' | 'current_stay'>;
  room: string;
  dateIn: string;
  dateOut: string;
  user?: Pick<User, 'id'> | null;
}

export async function checkInStay(db: AnyDb, input: CheckInStayInput): Promise<Stay> {
  assertNotAsiCustomer(input.customer);
  const room = String(input.room ?? '').trim();
  if (!room) throw new StayServiceError('room_required');
  assertStayDates(input.dateIn, input.dateOut);

  if (input.customer.in_house === true || input.customer.current_stay) {
    throw new StayServiceError('already_in_house');
  }

  const roomKey = normalizeRoomKey(room);
  if (!roomKey) throw new StayServiceError('room_required');

  const roomCandidates = await collectRoomCandidates(db, room);
  const asiOccupant = await findAsiOccupant(db, roomCandidates);
  if (asiOccupant) {
    throw new StayServiceError('room_occupied_asi', 'Room occupied by an ASI guest');
  }

  const customerId = toRecordId(idOf(input.customer.id));
  const tags = withInHouseTag(input.customer.tags, true);
  const checkedInBy = userRef(input.user);

  try {
    const result = await db.query(
      `BEGIN TRANSACTION;
       LET $cust = (SELECT * FROM ONLY $customer);
       IF $cust = NONE { THROW 'not_found' };
       IF $cust.current_stay != NONE OR $cust.in_house = true { THROW 'already_in_house' };
       LET $asi = (SELECT id FROM ${Tables.customers}
         WHERE ${ACTIVE_CUSTOMER}
           AND source = 'asi-fd'
           AND (in_house = true OR tags CONTAINS 'in-house')
           AND room IN $rooms);
       IF array::len($asi) > 0 { THROW 'room_occupied_asi' };
       LET $stay = (CREATE ONLY ${Tables.stays} SET
         customer = $customer,
         room = $room,
         room_key = $room_key,
         date_in = $date_in,
         date_out = $date_out,
         status = 'open',
         checked_in_by = $user,
         checked_in_at = time::now());
       UPDATE $customer SET
         current_stay = $stay.id,
         in_house = true,
         room = $room,
         tags = $tags,
         updated_at = time::now(),
         updated_by = $user;
       RETURN $stay;
       COMMIT TRANSACTION;`,
      {
        customer: customerId,
        room,
        room_key: roomKey,
        rooms: roomCandidates,
        date_in: input.dateIn,
        date_out: input.dateOut,
        user: checkedInBy,
        tags,
      },
      QUIET,
    );
    const stay = extractStay(result);
    if (!stay) throw new Error('Stay not created');
    return stay;
  } catch (error) {
    throw await diagnoseCheckInFailure(db, error, {
      customerId: input.customer.id,
      roomKey,
      roomCandidates,
    });
  }
}

export interface MoveStayInput {
  stay: Pick<Stay, 'id' | 'status' | 'customer' | 'room'>;
  room: string;
  user?: Pick<User, 'id'> | null;
}

export async function moveStay(db: AnyDb, input: MoveStayInput): Promise<Stay> {
  if (input.stay.status !== 'open') throw new StayServiceError('stay_not_open');
  const room = String(input.room ?? '').trim();
  if (!room) throw new StayServiceError('room_required');
  const roomKey = normalizeRoomKey(room);
  if (!roomKey) throw new StayServiceError('room_required');

  const roomCandidates = await collectRoomCandidates(db, room);
  const customerId = idOf(input.stay.customer);
  const asiOccupant = await findAsiOccupant(db, roomCandidates, customerId);
  if (asiOccupant) {
    throw new StayServiceError('room_occupied_asi');
  }

  try {
    const result = await db.query(
      `BEGIN TRANSACTION;
       LET $stay = (SELECT * FROM ONLY $id);
       IF $stay = NONE OR $stay.status != 'open' { THROW 'stay_not_open' };
       LET $asi = (SELECT id FROM ${Tables.customers}
         WHERE ${ACTIVE_CUSTOMER}
           AND source = 'asi-fd'
           AND (in_house = true OR tags CONTAINS 'in-house')
           AND room IN $rooms
           AND id != $customer);
       IF array::len($asi) > 0 { THROW 'room_occupied_asi' };
       UPDATE $id SET room = $room, room_key = $room_key;
       UPDATE $customer SET room = $room, updated_at = time::now(), updated_by = $user;
       RETURN (SELECT * FROM ONLY $id);
       COMMIT TRANSACTION;`,
      {
        id: toRecordId(idOf(input.stay.id)),
        customer: toRecordId(customerId),
        room,
        room_key: roomKey,
        rooms: roomCandidates,
        user: userRef(input.user),
      },
      QUIET,
    );
    const stay = extractStay(result);
    if (!stay) throw new Error('Stay not moved');
    return stay;
  } catch (error) {
    throw await diagnoseMoveFailure(db, error, {
      stayId: input.stay.id,
      customerId,
      roomKey,
      roomCandidates,
    });
  }
}

export async function extendStay(
  db: AnyDb,
  stay: Pick<Stay, 'id' | 'status' | 'date_in'>,
  dateOut: string,
  user?: Pick<User, 'id'> | null,
): Promise<Stay> {
  if (stay.status !== 'open') throw new StayServiceError('stay_not_open');
  assertStayDates(String(stay.date_in ?? ''), dateOut);
  try {
    const result = await db.query(
      `BEGIN TRANSACTION;
       LET $stay = (SELECT * FROM ONLY $id);
       IF $stay = NONE OR $stay.status != 'open' { THROW 'stay_not_open' };
       IF $date_out < $stay.date_in { THROW 'invalid_dates' };
       UPDATE $id SET date_out = $date_out;
       RETURN (SELECT * FROM ONLY $id);
       COMMIT TRANSACTION;`,
      {
        id: toRecordId(idOf(stay.id)),
        date_out: dateOut,
        user: userRef(user),
      },
      QUIET,
    );
    const updated = extractStay(result);
    if (!updated) throw new Error('Stay not extended');
    return updated;
  } catch (error) {
    throw await diagnoseStayFailure(db, error, stay.id, 'invalid_dates');
  }
}

type RoomPaymentRow = {
  id: unknown;
  amount?: number;
  comments?: string;
  payment_type?: { type?: string; name?: string };
};

/** Room tender lines on active (non-cancelled / non-refunded) orders for this stay. */
export async function loadStayRoomPayments(
  db: AnyDb,
  stayId: unknown,
): Promise<RoomPaymentRow[]> {
  const rows = rowsOf<RoomPaymentRow>(
    await db.query(
      `SELECT id, amount, comments, payment_type FROM ${Tables.order_payment}
       WHERE stay = $stay
       FETCH payment_type`,
      { stay: toRecordId(idOf(stayId)) },
    ),
  );
  const roomRows = rows.filter(
    (row) => String(row.payment_type?.type ?? '').toLowerCase() === ROOM_TYPE.toLowerCase(),
  );
  if (roomRows.length === 0) return [];

  // Drop lines that sit only on cancelled / refunded orders (do not under-count on query failure).
  try {
    const badOrders = rowsOf<{ payments?: unknown[] }>(
      await db.query(
        `SELECT payments FROM ${Tables.orders}
         WHERE deleted_at = none
           AND status IN $bad`,
        { bad: EXCLUDED_ORDER_STATUSES },
      ),
    );
    const excluded = new Set<string>();
    for (const order of badOrders) {
      for (const payment of order.payments ?? []) {
        excluded.add(idOf(payment));
      }
    }
    if (excluded.size === 0) return roomRows;
    return roomRows.filter((row) => !excluded.has(idOf(row.id)));
  } catch (error) {
    console.error('Stay Room folio order filter failed; counting all Room lines', error);
    return roomRows;
  }
}

/** Sum of Room tender amounts linked to this stay (excludes cancelled / refunded orders). */
export async function loadStayRoomTotal(db: AnyDb, stayId: unknown): Promise<number> {
  const rows = await loadStayRoomPayments(db, stayId);
  return rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

/** Clear the "fully settled" flag when a new Room charge is posted (keeps prior cash collections). */
export async function clearStayFullySettledFlag(db: AnyDb, stayId: unknown): Promise<void> {
  if (stayId == null || stayId === '') return;
  await db.query(
    `UPDATE $id SET room_settled_at = NONE, room_settled_by = NONE`,
    { id: toRecordId(idOf(stayId)) },
  );
}

/** Open orders for the stay's customer (warn at check-out). */
export async function loadOpenOrdersForCustomer(
  db: AnyDb,
  customerId: unknown,
): Promise<Array<{ id: unknown; invoice_number?: unknown; status?: string }>> {
  return rowsOf(
    await db.query(
      `SELECT id, invoice_number, status FROM ${Tables.orders}
       WHERE customer = $customer
         AND status IN ['In Progress', 'Pending']
         AND deleted_at = none`,
      { customer: toRecordId(idOf(customerId)) },
    ),
  );
}

export interface SettleStayRoomInput {
  stay: Pick<Stay, 'id' | 'status'>;
  /** Cash or Card (or other non-Room) payment type record id. */
  paymentTypeId: unknown;
  /** Amount to collect now; defaults to outstanding Room total. */
  amount?: number;
  comments?: string;
  user?: Pick<User, 'id'> | null;
}

/** Order tag of a Room folio settlement: a Paid order with no items, only the cash/card line. */
export const STAY_SETTLEMENT_TAG = 'stay-settlement';

/** Amount already collected on the stay: the sum of its stay_settlement rows. */
export async function loadStaySettledTotal(db: AnyDb, stayId: unknown): Promise<number> {
  const rows = rowsOf<number>(
    await db.query(
      `SELECT VALUE amount FROM ${Tables.stay_settlements} WHERE stay = $stay`,
      { stay: toRecordId(idOf(stayId)) },
    ),
  );
  return Math.round(rows.reduce((sum, amount) => sum + (Number(amount) || 0), 0) * 100) / 100;
}

/**
 * Cashier collects cash/card against the Room folio (payments.receive in UI).
 *
 * The money is a real payment: a Paid order tagged stay-settlement, no items, one cash/card
 * order_payment. The closing and cash reports count it like any other payment, with no
 * negative Room line (negative amounts read as refunds in the sales summaries).
 * What was collected before is summed inside the transaction, so two tills cannot
 * overwrite each other.
 */
export async function settleStayRoom(db: AnyDb, input: SettleStayRoomInput): Promise<Stay> {
  if (input.stay.status !== 'open') throw new StayServiceError('stay_not_open');
  if (input.paymentTypeId == null || input.paymentTypeId === '') {
    throw new StayServiceError('invalid_settle', 'Payment type required');
  }

  const [total, settled] = await Promise.all([
    loadStayRoomTotal(db, input.stay.id),
    loadStaySettledTotal(db, input.stay.id),
  ]);
  const outstanding = stayRoomOutstanding(total, settled);
  if (outstanding <= MONEY_EPS) {
    throw new StayServiceError('nothing_to_settle', 'Room folio already settled');
  }

  const amount = input.amount == null ? outstanding : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= MONEY_EPS) {
    throw new StayServiceError('invalid_settle', 'Settle amount must be positive');
  }
  if (amount > outstanding + MONEY_EPS) {
    throw new StayServiceError('invalid_settle', 'Settle amount exceeds outstanding folio');
  }
  const rounded = Math.round(amount * 100) / 100;
  const counters = db as Parameters<typeof generateNextInvoiceNumber>[0];
  const [invoiceNumber, autoId] = [await generateNextInvoiceNumber(counters), await getNextAutoId(counters)];

  try {
    const result = await db.query(
      `BEGIN TRANSACTION;
       LET $stay = (SELECT * FROM ONLY $id);
       IF $stay = NONE OR $stay.status != 'open' { THROW 'stay_not_open' };
       LET $before = math::sum((SELECT VALUE amount FROM ${Tables.stay_settlements} WHERE stay = $id));
       IF $amount > $total - $before + ${MONEY_EPS} { THROW 'invalid_settle' };
       LET $type = (SELECT id, priority FROM order_type WHERE deleted_at = NONE ORDER BY priority LIMIT 1)[0].id;
       IF $type = NONE { THROW 'no_order_type' };
       LET $payment = (CREATE ONLY ${Tables.order_payment} SET
         amount = $amount,
         payable = $amount,
         payment_type = $payment_type,
         comments = $comments);
       LET $order = (CREATE ONLY ${Tables.orders} SET
         status = '${OrderStatus.Paid}',
         items = [],
         payments = [$payment.id],
         order_type = $type,
         customer = $stay.customer,
         user = $user,
         cashier = $user,
         invoice_number = $invoice_number,
         auto_id = $auto_id,
         created_at = time::now(),
         completed_at = time::now(),
         tags = ['${STAY_SETTLEMENT_TAG}'],
         notes = $notes);
       CREATE ${Tables.stay_settlements} SET
         stay = $id,
         order = $order.id,
         amount = $amount,
         payment_type = $payment_type,
         created_by = $user,
         created_at = time::now(),
         comments = $comments;
       LET $paid = math::round(($before + $amount) * 100) / 100;
       LET $full = $paid + ${MONEY_EPS} >= $total;
       UPDATE $id SET
         settled_amount = $paid,
         room_settled_at = IF $full { time::now() } ELSE { NONE },
         room_settled_by = IF $full { $user } ELSE { NONE };
       RETURN (SELECT * FROM ONLY $id);
       COMMIT TRANSACTION;`,
      {
        id: toRecordId(idOf(input.stay.id)),
        amount: rounded,
        total,
        payment_type: toRecordId(idOf(input.paymentTypeId)),
        user: userRef(input.user),
        comments: input.comments?.trim() || 'Room folio settlement',
        notes: 'Règlement séjour',
        invoice_number: invoiceNumber,
        auto_id: autoId,
      },
      QUIET,
    );
    const updated = extractStay(result);
    if (!updated) throw new Error('Stay not settled');
    return updated;
  } catch (error) {
    throw await diagnoseStayFailure(db, error, input.stay.id, 'invalid_settle');
  }
}

export interface CheckOutStayInput {
  stay: Pick<Stay, 'id' | 'status' | 'customer'>;
  customer: Pick<Customer, 'id' | 'tags'>;
  user?: Pick<User, 'id'> | null;
}

export async function checkOutStay(db: AnyDb, input: CheckOutStayInput): Promise<Stay> {
  if (input.stay.status !== 'open') throw new StayServiceError('stay_not_open');

  const [total, settled] = await Promise.all([
    loadStayRoomTotal(db, input.stay.id),
    loadStaySettledTotal(db, input.stay.id),
  ]);
  if (!isStayRoomSettled(total, settled)) {
    throw new StayServiceError('room_unsettled', 'Room folio must be settled before check-out');
  }

  const tags = withInHouseTag(input.customer.tags, false);
  try {
    const result = await db.query(
      `BEGIN TRANSACTION;
       LET $stay = (SELECT * FROM ONLY $id);
       IF $stay = NONE OR $stay.status != 'open' { THROW 'stay_not_open' };
       LET $paid = math::sum((SELECT VALUE amount FROM ${Tables.stay_settlements} WHERE stay = $id));
       IF $paid + ${MONEY_EPS} < $total { THROW 'room_unsettled' };
       UPDATE $id SET
         status = 'closed',
         checked_out_by = $user,
         checked_out_at = time::now(),
         room_total_at_checkout = $total;
       UPDATE $customer SET
         current_stay = NONE,
         in_house = false,
         room = NONE,
         tags = $tags,
         updated_at = time::now(),
         updated_by = $user;
       RETURN (SELECT * FROM ONLY $id);
       COMMIT TRANSACTION;`,
      {
        id: toRecordId(idOf(input.stay.id)),
        customer: toRecordId(idOf(input.customer.id)),
        user: userRef(input.user),
        tags,
        total,
      },
      QUIET,
    );
    const stay = extractStay(result);
    if (!stay) throw new Error('Stay not checked out');
    return stay;
  } catch (error) {
    throw await diagnoseStayFailure(db, error, input.stay.id, 'room_unsettled');
  }
}

export async function listOpenStays(db: AnyDb): Promise<Stay[]> {
  return rowsOf<Stay>(
    await db.query(
      `SELECT * FROM ${Tables.stays}
       WHERE status = 'open'
       ORDER BY checked_in_at DESC
       FETCH customer, checked_in_by`,
    ),
  );
}

/** Rooms where both an ASI guest and a manual stay (or two guests) claim the same key. */
export async function listRoomConflicts(
  db: AnyDb,
): Promise<Array<{ roomKey: string; guests: Customer[] }>> {
  const guests = rowsOf<Customer>(
    await db.query(
      `SELECT * FROM ${Tables.customers}
       WHERE ${ACTIVE_CUSTOMER}
         AND (in_house = true OR tags CONTAINS 'in-house')
         AND room != NONE AND room != NULL`,
    ),
  );
  const byKey = new Map<string, Customer[]>();
  for (const guest of guests) {
    const key = normalizeRoomKey(guest.room);
    if (!key) continue;
    const list = byKey.get(key) ?? [];
    list.push(guest);
    byKey.set(key, list);
  }
  const tables = rowsOf<Table>(
    await db.query(
      `SELECT number, asi_alias FROM ${Tables.tables}
       WHERE deleted_at = none AND source = 'asi-room'`,
    ),
  );
  for (const table of tables) {
    const numKey = normalizeRoomKey(table.number);
    const aliasKey = normalizeRoomKey(table.asi_alias as string | undefined);
    if (!numKey || !aliasKey || numKey === aliasKey) continue;
    const a = byKey.get(numKey) ?? [];
    const b = byKey.get(aliasKey) ?? [];
    if (a.length && b.length) {
      const merged = [...a];
      for (const g of b) {
        if (!merged.some((x) => idOf(x.id) === idOf(g.id))) merged.push(g);
      }
      byKey.set(numKey, merged);
      byKey.delete(aliasKey);
    }
  }
  return [...byKey.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([roomKey, list]) => ({ roomKey, guests: list }));
}

/** Append a staff note without wiping the previous one. */
export function appendCustomerNote(
  existing: string | null | undefined,
  addition: string | null | undefined,
): string | null {
  const next = String(addition ?? '').trim();
  if (!next) return existing?.trim() ? String(existing).trim() : null;
  const prev = String(existing ?? '').trim();
  if (!prev) return next;
  if (prev.includes(next)) return prev;
  return `${prev}\n${next}`;
}

function extractStay(result: unknown): Stay | undefined {
  if (!Array.isArray(result)) return undefined;
  for (let i = result.length - 1; i >= 0; i -= 1) {
    const chunk = result[i];
    if (Array.isArray(chunk) && chunk[0] && typeof chunk[0] === 'object' && 'room_key' in chunk[0]) {
      return chunk[0] as Stay;
    }
    if (chunk && typeof chunk === 'object' && !Array.isArray(chunk) && 'room_key' in chunk) {
      return chunk as Stay;
    }
  }
  return undefined;
}

function mapStayWriteError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/room_occupied_asi/.test(message)) return new StayServiceError('room_occupied_asi');
  if (/already_in_house/.test(message)) return new StayServiceError('already_in_house');
  if (/stay_not_open/.test(message)) return new StayServiceError('stay_not_open');
  if (/invalid_dates/.test(message)) return new StayServiceError('invalid_dates');
  if (/room_unsettled/.test(message)) return new StayServiceError('room_unsettled');
  if (/not_found/.test(message)) return new StayServiceError('not_found');
  if (/open_room_key|stay_open_room_key|unique/i.test(message)) {
    return new StayServiceError('room_occupied_manual', 'Room already has an open manual stay');
  }
  return error instanceof Error ? error : new Error(message);
}

/**
 * Driver strips THROW text on failed transactions — re-read the DB like order-merge.
 */
async function diagnoseCheckInFailure(
  db: AnyDb,
  error: unknown,
  ctx: { customerId: unknown; roomKey: string; roomCandidates: string[] },
): Promise<Error> {
  const mapped = mapStayWriteError(error);
  if (mapped instanceof StayServiceError && mapped.code !== 'not_found') {
    // Still prefer DB truth when the message was generic ("failed transaction").
    const generic = /not executed|failed transaction/i.test(
      error instanceof Error ? error.message : String(error),
    );
    if (!generic) return mapped;
  }

  try {
    const customer = rowsOf<Customer>(
      await db.query(`SELECT * FROM $id`, { id: toRecordId(idOf(ctx.customerId)) }),
    )[0];
    if (customer && (customer.current_stay != null || customer.in_house === true)) {
      return new StayServiceError('already_in_house');
    }
    const asi = await findAsiOccupant(db, ctx.roomCandidates, ctx.customerId);
    if (asi) return new StayServiceError('room_occupied_asi');
    const open = rowsOf<{ id: unknown }>(
      await db.query(
        `SELECT id FROM ${Tables.stays} WHERE status = 'open' AND open_room_key = $key LIMIT 1`,
        { key: ctx.roomKey },
      ),
    );
    if (open[0]) return new StayServiceError('room_occupied_manual');
  } catch {
    // Fall through to original mapping.
  }
  return mapped;
}

async function diagnoseMoveFailure(
  db: AnyDb,
  error: unknown,
  ctx: { stayId: unknown; customerId: string; roomKey: string; roomCandidates: string[] },
): Promise<Error> {
  const mapped = mapStayWriteError(error);
  const generic = /not executed|failed transaction/i.test(
    error instanceof Error ? error.message : String(error),
  );
  if (!generic && mapped instanceof StayServiceError) return mapped;

  try {
    const stay = rowsOf<Stay>(
      await db.query(`SELECT * FROM $id`, { id: toRecordId(idOf(ctx.stayId)) }),
    )[0];
    if (!stay || stay.status !== 'open') return new StayServiceError('stay_not_open');
    const asi = await findAsiOccupant(db, ctx.roomCandidates, ctx.customerId);
    if (asi) return new StayServiceError('room_occupied_asi');
    const open = rowsOf<{ id: unknown }>(
      await db.query(
        `SELECT id FROM ${Tables.stays}
         WHERE status = 'open' AND open_room_key = $key AND id != $id LIMIT 1`,
        { key: ctx.roomKey, id: toRecordId(idOf(ctx.stayId)) },
      ),
    );
    if (open[0]) return new StayServiceError('room_occupied_manual');
  } catch {
    // Fall through.
  }
  return mapped;
}

/**
 * Same as above for a write on one stay: the driver hides the THROW text, so read the stay
 * back. Closed (or gone) → stay_not_open; still open → the one other THROW of that write.
 */
async function diagnoseStayFailure(
  db: AnyDb,
  error: unknown,
  stayId: unknown,
  otherwise: StayServiceError['code'],
): Promise<Error> {
  const mapped = mapStayWriteError(error);
  const generic = /not executed|failed transaction/i.test(
    error instanceof Error ? error.message : String(error),
  );
  if (!generic) return mapped;
  try {
    const stay = rowsOf<Stay>(
      await db.query(`SELECT status FROM $id`, { id: toRecordId(idOf(stayId)) }),
    )[0];
    return new StayServiceError(!stay || stay.status !== 'open' ? 'stay_not_open' : otherwise);
  } catch {
    return mapped;
  }
}
