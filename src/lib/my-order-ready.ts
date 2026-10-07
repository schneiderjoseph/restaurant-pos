import { Order } from '@/api/model/order.ts';
import {
  classifyOrder,
  getKitchenStationStatuses,
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
  /** Station that finished its part ("Bar") while another still works, else ''. */
  station: string;
}

export const toReadyAlert = (order: Order, station = ''): ReadyAlert => ({
  id: station ? `${order.id.toString()}#${station}` : order.id.toString(),
  station,
  orderNumber: getInvoiceNumber(order),
  displayNumber: formatOrderNumber(order),
  guest: formatGuestLabel(order.customer),
  spokenGuest: (order.customer?.name ?? '').trim(),
  table: formatTableLabel(order.table),
  room: isHotelRoomTable(order.table) ? String(order.table?.number ?? '').trim() : '',
});

/**
 * i18n key and values for the spoken announcement: guest name first, else the room, else
 * the table. A station alert says the same, then which station is ready.
 */
export const readyAnnouncement = (
  alert: ReadyAlert,
): { key: string; values: Record<string, string> } => {
  const prefix = alert.station ? 'readyAlert.speechStation' : 'readyAlert.speech';
  const values: Record<string, string> = alert.station
    ? { number: alert.orderNumber, station: alert.station }
    : { number: alert.orderNumber };
  if (alert.spokenGuest) {
    return { key: `${prefix}Guest`, values: { ...values, guest: alert.spokenGuest } };
  }
  if (alert.room) {
    return { key: `${prefix}Room`, values: { ...values, room: alert.room } };
  }
  if (alert.table) {
    // "T4" is read "table 4"; another code (B3) is read as it is.
    const table = alert.table.replace(/^(?:t|table)\s*(?=\d)/i, '');
    return { key: `${prefix}Table`, values: { ...values, table } };
  }
  return { key: prefix, values };
};

/** Last ready flag seen for each station of each order (order id -> kitchen id -> ready). */
export type StationReadyState = Map<string, Map<string, boolean>>;

/**
 * Stations (bar, kitchen…) that finished their part of an order this terminal saw them
 * working on, while another station still works on it. The last station is covered by the
 * whole-order alert, and a single-station order only gets that one.
 */
export const findNewlyReadyStations = (
  previous: StationReadyState,
  orders: Order[],
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId,
): { stations: StationReadyState; newlyReady: { order: Order; station: string }[] } => {
  const stations: StationReadyState = new Map();
  const newlyReady: { order: Order; station: string }[] = [];

  for (const order of orders) {
    const id = order.id.toString();
    const statuses = getKitchenStationStatuses(order, kitchenRowsByOrderItemId);
    const prev = previous.get(id);
    const orderRunning = statuses.some(status => !status.ready);

    if (statuses.length > 1 && orderRunning) {
      for (const status of statuses) {
        if (status.ready && prev?.get(status.kitchenId) === false) {
          newlyReady.push({ order, station: status.kitchenName });
        }
      }
    }
    stations.set(id, new Map(statuses.map(status => [status.kitchenId, status.ready])));
  }

  return { stations, newlyReady };
};
