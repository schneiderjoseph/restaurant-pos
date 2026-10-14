import { OrderStatus } from '@/api/model/order.ts';
import { CREDIT_PAYMENT_TYPE, isCreditPaymentType } from '@/lib/credit-charge.ts';
import { isRoomPaymentType, ROOM_PAYMENT_TYPE } from '@/lib/room-charge.ts';

/** How a closed check was deferred (not cash/card collected at the till). */
export type OrderDeferredCharge = 'room' | 'credit';

/** Status-filter values on /orders (not real `order.status` — Paid + Room/Credit tender). */
export const ORDER_FILTER_ROOM = ROOM_PAYMENT_TYPE;
export const ORDER_FILTER_CREDIT = CREDIT_PAYMENT_TYPE;

/** Surreal WHERE fragment for a status multi-select value (Paid / Room / Credit / …). */
export function orderStatusFilterClause(statusValue: string): string {
  if (statusValue === ORDER_FILTER_ROOM) {
    return `(status = "${OrderStatus.Paid}" AND payments.payment_type.type CONTAINSANY ["${ROOM_PAYMENT_TYPE}"])`;
  }
  if (statusValue === ORDER_FILTER_CREDIT) {
    return `(status = "${OrderStatus.Paid}" AND payments.payment_type.type CONTAINSANY ["${CREDIT_PAYMENT_TYPE}"])`;
  }
  return `status = "${statusValue}"`;
}

type PaymentLike = {
  payment_type?: { type?: string } | null;
} | null | undefined;

/**
 * Room / Credit tenders on a Paid order: the ticket is closed but money is still
 * on the room folio or house account — not "collected".
 */
export function orderDeferredCharges(
  order: { status?: string; payments?: PaymentLike[] } | null | undefined,
): OrderDeferredCharge[] {
  if (!order) return [];
  if (String(order.status ?? '') !== OrderStatus.Paid) {
    return [];
  }

  const payments = Array.isArray(order.payments) ? order.payments : [];
  let room = false;
  let credit = false;
  for (const payment of payments) {
    if (!payment?.payment_type) continue;
    if (isRoomPaymentType(payment.payment_type)) room = true;
    if (isCreditPaymentType(payment.payment_type)) credit = true;
  }

  const out: OrderDeferredCharge[] = [];
  if (room) out.push('room');
  if (credit) out.push('credit');
  return out;
}
