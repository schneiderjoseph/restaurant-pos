import { Tables } from '@/api/db/tables.ts';
import type { Order } from '@/api/model/order.ts';
import { buildCreatedAtDateConditions, unwrapQueryResult } from '@/api/reports/shared/query.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';
import type { DateRangeFilter, DbClient } from '@/api/reports/shared/types.ts';
import { toJsDate } from '@/lib/datetime.ts';
import { getAppliedPaymentAmounts, getOrderPaymentTotals } from '@/lib/order.ts';
import { isRoomPaymentType } from '@/lib/room-charge.ts';
import { safeNumber } from '@/lib/utils.ts';

/**
 * Charged to rooms (ASI "Room Charges Posted"): every paid order put on a
 * hotel guest's room, with the guest, the room and the folio it went to.
 * ASI guests post to their FrontDesk folio; manual POS stays post to the stay
 * and are settled at check-out (stay-settlement orders).
 */
export type RoomChargeRow = {
  orderId: string;
  invoiceNumber: number | null;
  createdAt: Date | null;
  guestId: string;
  guestName: string;
  room: string;
  /** ASI FrontDesk folio number; empty for a manual stay. */
  folio: string;
  source: 'asi' | 'manual';
  /** Guest still in-house now (ASI sync / open manual stay). */
  inHouse: boolean;
  /** Manual stay only: stay id, closed and settled flags. */
  stayId: string;
  stayClosed: boolean;
  staySettled: boolean;
  /** Amount put on the room by this order. */
  roomAmount: number;
  /** Everything applied to the order (room + till + credit). */
  orderTotal: number;
  cashierName: string;
};

type PersonRef = { id?: unknown; first_name?: string; last_name?: string; login?: string };
type CustomerRef = {
  id?: unknown;
  name?: string;
  room?: string;
  source?: string | null;
  in_house?: boolean;
  asi_folio_no?: string | null;
  asi_checkin_id?: number | null;
};
type StayRef = { id?: unknown; room?: string; status?: string; room_settled_at?: unknown };

const personName = (u?: PersonRef | null): string => {
  if (!u || typeof u !== 'object') return '';
  return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.login || '';
};

const toDate = (value: unknown): Date | null => {
  if (value == null) return null;
  try {
    const d = toJsDate(value as Parameters<typeof toJsDate>[0]);
    return Number.isFinite(d.getTime()) ? d : null;
  } catch {
    return null;
  }
};

export function buildRoomChargeRows(orders: Order[]): RoomChargeRow[] {
  const rows: RoomChargeRow[] = [];
  for (const order of orders) {
    const payments = (order.payments ?? []).filter((p) => p != null);
    const applied = getAppliedPaymentAmounts(payments);
    let roomAmount = 0;
    let stay: StayRef | undefined;
    payments.forEach((payment, index) => {
      if (!isRoomPaymentType(payment?.payment_type)) return;
      roomAmount += safeNumber(applied[index]);
      const s = (payment as { stay?: unknown }).stay;
      if (!stay && s && typeof s === 'object') stay = s as StayRef;
    });
    if (roomAmount <= 0) continue;
    const customer = (order.customer ?? undefined) as CustomerRef | undefined;
    const isAsi = customer?.source === 'asi-fd' || customer?.asi_checkin_id != null;
    const stayId = recordIdToString(stay?.id);
    const stayOpen = stay ? stay.status === 'open' : false;
    rows.push({
      orderId: recordIdToString(order.id),
      invoiceNumber: typeof order.invoice_number === 'number' ? order.invoice_number : null,
      createdAt: toDate(order.created_at),
      guestId: recordIdToString(customer?.id) || '',
      guestName: String(customer?.name ?? '').trim(),
      room: String(stay?.room ?? customer?.room ?? '').trim(),
      folio: isAsi ? String(customer?.asi_folio_no ?? '').trim() : '',
      source: isAsi ? 'asi' : 'manual',
      inHouse: isAsi ? customer?.in_house === true : stayOpen,
      stayId,
      stayClosed: !isAsi && !!stay && !stayOpen,
      staySettled: !isAsi && !!stay?.room_settled_at,
      roomAmount: safeNumber(roomAmount),
      orderTotal: safeNumber(getOrderPaymentTotals(order).amountApplied),
      cashierName: personName((order.cashier ?? order.user) as unknown as PersonRef),
    });
  }
  return rows.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
}

export type RoomChargeReport = {
  rows: RoomChargeRow[];
  /** Everything applied to all paid orders of the period, for the room share. */
  periodSales: number;
};

export const getRoomChargeReport = async (db: DbClient, range: DateRangeFilter): Promise<RoomChargeReport> => {
  const filter = buildCreatedAtDateConditions(range);
  const where = ["status = 'Paid'", 'deleted_at = none', ...filter.conditions].join(' AND ');
  const [roomOrders, allPayments] = await Promise.all([
    db.query(
      `SELECT * FROM ${Tables.orders}
       WHERE ${where} AND payments.payment_type.type CONTAINSANY ['Room', 'room', 'ROOM']
       FETCH customer, payments, payments.payment_type, payments.stay, cashier, user`,
      filter.params,
    ),
    db.query(
      `SELECT payments FROM ${Tables.orders} WHERE ${where} FETCH payments, payments.payment_type`,
      filter.params,
    ),
  ]);
  const periodSales = unwrapQueryResult<Order>(allPayments)
    .reduce((sum, order) => sum + safeNumber(getOrderPaymentTotals(order).amountApplied), 0);
  return { rows: buildRoomChargeRows(unwrapQueryResult<Order>(roomOrders)), periodSales: safeNumber(periodSales) };
};
