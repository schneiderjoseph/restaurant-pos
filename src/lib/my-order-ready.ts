import { Order } from '@/api/model/order.ts';
import {
  classifyOrder,
  getReadyAt,
  KitchenRowsByOrderItemId,
  OrderDisplayColumn,
} from '@/lib/order-display.ts';
import { formatOrderNumber, getInvoiceNumber } from '@/lib/order.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';
import {formatTableLabel} from "@/lib/table-label.ts";
import {isHotelRoomTable} from "@/lib/kitchen-ticket-label.ts";

/** Last column + ready stamp seen for each order id ('running' = kitchen still working). */
export type OrderReadyWatch = {
  column: OrderDisplayColumn | null;
  /** Max kitchen completed_at (ms) when this order was last seen ready; used to re-alert after recall. */
  readyAtMs: number | null;
};

/** @deprecated Prefer OrderReadyWatch — kept as alias for call sites that only need the column map shape. */
export type OrderColumns = Map<string, OrderDisplayColumn | null>;

export type OrderReadyState = Map<string, OrderReadyWatch>;

const watchColumn = (state: OrderReadyState | OrderColumns, id: string): OrderDisplayColumn | null | undefined => {
  const value = state.get(id);
  if (value == null || typeof value === 'string') {
    return value as OrderDisplayColumn | null | undefined;
  }
  return (value as OrderReadyWatch).column;
};

const watchReadyAt = (state: OrderReadyState | OrderColumns, id: string): number | null => {
  const value = state.get(id);
  if (value == null || typeof value === 'string') {
    return null;
  }
  return (value as OrderReadyWatch).readyAtMs;
};

/**
 * Orders this terminal saw in preparation that the kitchen has now finished. An order that
 * never had kitchen work, or was already ready when first seen, is not announced.
 * After a kitchen recall, finishing again must alert even if the brief "running" blip was
 * missed (live debounce), so a newer ready stamp also counts as newly ready.
 */
export const findNewlyReadyOrders = (
  previous: OrderReadyState | OrderColumns,
  orders: Order[],
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId,
): { columns: OrderReadyState; newlyReady: Order[] } => {
  const columns: OrderReadyState = new Map();
  const newlyReady: Order[] = [];

  for (const order of orders) {
    const id = order.id.toString();
    const column = classifyOrder(order, kitchenRowsByOrderItemId);
    const prevColumn = watchColumn(previous, id);
    const prevReadyAt = watchReadyAt(previous, id);

    if (column === 'ready') {
      const readyAtMs = getReadyAt(order, kitchenRowsByOrderItemId).toMillis();
      const finishedAgain =
        prevColumn === 'running' ||
        (prevColumn === 'ready' && prevReadyAt != null && readyAtMs > prevReadyAt);
      if (finishedAgain) {
        newlyReady.push(order);
      }
      columns.set(id, { column, readyAtMs });
    } else {
      columns.set(id, { column, readyAtMs: prevReadyAt });
    }
  }

  return { columns, newlyReady };
};

export interface ReadyAlert {
  id: string;
  /** Plain number, for speech. */
  orderNumber: string;
  /** #012, for the popup. */
  displayNumber: string;
  /** Guest name, or #code when the guest has no name. */
  guest: string;
  /** Guest name only — a #code is not read aloud. */
  spokenGuest: string;
  table: string;
  /** Room number when the order is on a hotel room, else ''. Read aloud as "room 20". */
  room: string;
}

export const toReadyAlert = (order: Order): ReadyAlert => ({
  id: order.id.toString(),
  orderNumber: getInvoiceNumber(order),
  displayNumber: formatOrderNumber(order),
  guest: formatGuestLabel(order.customer),
  spokenGuest: (order.customer?.name ?? '').trim(),
  table: formatTableLabel(order.table),
  room: isHotelRoomTable(order.table) ? String(order.table?.number ?? '').trim() : '',
});

/** i18n key and values for the spoken announcement: guest name first, else the table. */
export const readyAnnouncement = (
  alert: ReadyAlert,
): { key: string; values: Record<string, string> } => {
  if (alert.spokenGuest) {
    return { key: 'readyAlert.speechGuest', values: { number: alert.orderNumber, guest: alert.spokenGuest } };
  }
  if (alert.room) {
    return { key: 'readyAlert.speechRoom', values: { number: alert.orderNumber, room: alert.room } };
  }
  if (alert.table) {
    // "T4" is read "table 4"; another code (B3) is read as it is.
    const table = alert.table.replace(/^(?:t|table)\s*(?=\d)/i, '');
    return { key: 'readyAlert.speechTable', values: { number: alert.orderNumber, table } };
  }
  return { key: 'readyAlert.speech', values: { number: alert.orderNumber } };
};
