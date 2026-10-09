import { Order } from '@/api/model/order.ts';
import {
  classifyOrder,
  getKitchenStationStatuses,
  getReadyAt,
  kitchenOrderItemKey,
  KitchenRowsByOrderItemId,
  OrderDisplayColumn,
} from '@/lib/order-display.ts';
import { formatOrderNumber, getInvoiceNumber, getOrderFilteredItems } from '@/lib/order.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';
import {formatTableLabel} from "@/lib/table-label.ts";
import {isHotelRoomTable} from "@/lib/kitchen-ticket-label.ts";

/** Last column + ready stamp seen for each order id ('running' = kitchen still working). */
export type OrderReadyWatch = {
  column: OrderDisplayColumn | null;
  /** Max kitchen completed_at (ms) when this order was last seen ready; used to re-alert after recall. */
  readyAtMs: number | null;
  /** Kitchen rows with completed_at — drops on recall, stays put when an addon is fired. */
  completedKitchenCount: number;
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

const watchCompletedCount = (state: OrderReadyState | OrderColumns, id: string): number | null => {
  const value = state.get(id);
  if (value == null || typeof value === 'string') {
    return null;
  }
  const count = (value as OrderReadyWatch).completedKitchenCount;
  return typeof count === 'number' ? count : null;
};

/** How many kitchen stage rows for this order currently have a completed_at stamp. */
export const countCompletedKitchenRows = (
  order: Order,
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId,
): number => {
  let count = 0;
  for (const item of getOrderFilteredItems(order)) {
    // Same keying as classifyOrder / getReadyAt (split-by-amount follows the original line).
    const key = kitchenOrderItemKey(item.split_source ?? item.id);
    if (!key) {
      continue;
    }
    for (const row of kitchenRowsByOrderItemId[key] ?? []) {
      if (row.completed_at) {
        count += 1;
      }
    }
  }
  return count;
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
): { columns: OrderReadyState; newlyReady: Order[]; newlyRecalled: Order[] } => {
  const columns: OrderReadyState = new Map();
  const newlyReady: Order[] = [];
  const newlyRecalled: Order[] = [];

  for (const order of orders) {
    const id = order.id.toString();
    const column = classifyOrder(order, kitchenRowsByOrderItemId);
    const prevColumn = watchColumn(previous, id);
    const prevReadyAt = watchReadyAt(previous, id);
    const prevCompleted = watchCompletedCount(previous, id);
    const completedKitchenCount = countCompletedKitchenRows(order, kitchenRowsByOrderItemId);

    if (column === 'ready') {
      const readyAtMs = getReadyAt(order, kitchenRowsByOrderItemId).toMillis();
      const finishedAgain =
        prevColumn === 'running' ||
        (prevColumn === 'ready' && prevReadyAt != null && readyAtMs > prevReadyAt);
      if (finishedAgain) {
        newlyReady.push(order);
      }
      columns.set(id, { column, readyAtMs, completedKitchenCount });
    } else {
      // Recall clears completed_at on existing rows; an addon only adds pending rows.
      if (
        prevColumn === 'ready'
        && column === 'running'
        && prevCompleted != null
        && completedKitchenCount < prevCompleted
      ) {
        newlyRecalled.push(order);
      }
      columns.set(id, { column, readyAtMs: prevReadyAt, completedKitchenCount });
    }
  }

  return { columns, newlyReady, newlyRecalled };
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
  /** Kitchen recalled a ready order back to cooking. */
  recalled?: boolean;
}

export const toReadyAlert = (order: Order, station = '', recalled = false): ReadyAlert => ({
  id: recalled
    ? `${order.id.toString()}#recalled`
    : station
      ? `${order.id.toString()}#${station}`
      : order.id.toString(),
  station,
  recalled,
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
  if (alert.recalled) {
    const values: Record<string, string> = { number: alert.orderNumber };
    if (alert.spokenGuest) {
      return { key: 'readyAlert.recalledSpeechGuest', values: { ...values, guest: alert.spokenGuest } };
    }
    if (alert.room) {
      return { key: 'readyAlert.recalledSpeechRoom', values: { ...values, room: alert.room } };
    }
    if (alert.table) {
      const table = alert.table.replace(/^(?:t|table)\s*(?=\d)/i, '');
      return { key: 'readyAlert.recalledSpeechTable', values: { ...values, table } };
    }
    return { key: 'readyAlert.recalledSpeech', values };
  }

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
