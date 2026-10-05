import { Order } from '@/api/model/order.ts';
import { classifyOrder, KitchenRowsByOrderItemId, OrderDisplayColumn } from '@/lib/order-display.ts';
import { formatOrderNumber, getInvoiceNumber } from '@/lib/order.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';
import {formatTableLabel} from "@/lib/table-label.ts";
import {isHotelRoomTable} from "@/lib/kitchen-ticket-label.ts";

/** Last column seen for each order id ('running' = kitchen still working). */
export type OrderColumns = Map<string, OrderDisplayColumn | null>;

/**
 * Orders this terminal saw in preparation that the kitchen has now finished. An order that
 * never had kitchen work, or was already ready when first seen, is not announced.
 */
export const findNewlyReadyOrders = (
  previous: OrderColumns,
  orders: Order[],
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId,
): { columns: OrderColumns; newlyReady: Order[] } => {
  const columns: OrderColumns = new Map();
  const newlyReady: Order[] = [];

  for (const order of orders) {
    const id = order.id.toString();
    const column = classifyOrder(order, kitchenRowsByOrderItemId);
    columns.set(id, column);
    if (column === 'ready' && previous.get(id) === 'running') {
      newlyReady.push(order);
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
