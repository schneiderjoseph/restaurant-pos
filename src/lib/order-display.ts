import { Order } from '@/api/model/order.ts';
import { OrderItemKitchen, OrderItemKitchenStatus } from '@/api/model/order_item_kitchen.ts';
import { getOrderFilteredItems } from '@/lib/order.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { DateTime } from 'luxon';

export type OrderDisplayColumn = 'running' | 'ready';

export type KitchenRowsByOrderItemId = Record<string, OrderItemKitchen[]>;

export const ORDER_DISPLAY_MAX_VISIBLE = 12;

export const INCOMPLETE_KITCHEN_STATUSES = new Set<string>([
  OrderItemKitchenStatus.Waiting,
  OrderItemKitchenStatus.Pending,
  OrderItemKitchenStatus.InProgress,
]);

/** Order items flattened for the Orders-screen ready check (one query, no FETCH). */
export type KitchenReadyItem = {
  order: unknown;
  deleted_at?: unknown;
  is_refunded?: boolean | null;
  is_suspended?: boolean | null;
};

/** Kitchen rows flattened for the Orders-screen ready check (one query, no FETCH). */
export type KitchenReadyRow = {
  order: unknown;
  status?: string | null;
  deleted_at?: unknown;
  is_suspended?: boolean | null;
};

/** Full "order:id" string, as the Orders screen keys its list (`order.id.toString()`). */
const orderIdKey = (order: unknown): string => {
  const asString = order == null ? '' : String(order);
  return asString === '[object Object]' ? kitchenOrderItemKey(order) : asString;
};

/**
 * Order ids the order display would put under "ready" (same rule as `classifyOrder`): at
 * least one live item, and no kitchen row still to do. An order with nothing sent to a
 * kitchen is ready. Soft-deleted, refunded and suspended items are ignored.
 */
export function kitchenReadyOrderIds(
  items: KitchenReadyItem[] = [],
  rows: KitchenReadyRow[] = []
): Set<string> {
  const ready = new Set<string>();

  for (const item of items) {
    if (item.deleted_at || item.is_refunded === true || item.is_suspended === true) {
      continue;
    }
    const orderId = orderIdKey(item.order);
    if (orderId) {
      ready.add(orderId);
    }
  }

  for (const row of rows) {
    if (row.deleted_at || row.is_suspended === true) {
      continue;
    }
    if (row.status && INCOMPLETE_KITCHEN_STATUSES.has(row.status)) {
      ready.delete(orderIdKey(row.order));
    }
  }

  return ready;
}

/** Stable key for order_item whether FETCH expanded it or left a RecordId. */
export function kitchenOrderItemKey(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    const record = value as { tb?: string; id?: unknown; toString?: () => string };
    if (record.tb != null && record.id != null) {
      if (typeof record.toString === 'function') {
        const asString = record.toString();
        if (asString && asString !== '[object Object]') {
          return asString;
        }
      }
      return `${record.tb}:${String(record.id)}`;
    }
    if ('id' in record && record.id != null) {
      return kitchenOrderItemKey(record.id);
    }
    if (typeof record.toString === 'function') {
      const asString = record.toString();
      if (asString && asString !== '[object Object]') {
        return asString;
      }
    }
  }
  return String(value);
}

export function buildKitchenRowsMap(rows: OrderItemKitchen[] = []): KitchenRowsByOrderItemId {
  const map: KitchenRowsByOrderItemId = {};

  for (const row of rows) {
    const orderItem = row.order_item as unknown;
    if (!orderItem) {
      continue;
    }

    if (typeof orderItem === 'object' && (orderItem as { deleted_at?: unknown }).deleted_at) {
      continue;
    }

    if (typeof orderItem === 'object' && (orderItem as { is_suspended?: boolean }).is_suspended === true) {
      continue;
    }

    const key = kitchenOrderItemKey(orderItem);
    if (!key) {
      continue;
    }

    if (!map[key]) {
      map[key] = [];
    }

    map[key].push(row);
  }

  return map;
}

const rowsForItem = (
  item: { id?: unknown },
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId
): OrderItemKitchen[] => {
  const key = kitchenOrderItemKey(item?.id);
  if (!key) {
    return [];
  }
  return kitchenRowsByOrderItemId[key] ?? [];
};

export function classifyOrder(
  order: Order,
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId
): OrderDisplayColumn | null {
  const items = getOrderFilteredItems(order);
  if (items.length === 0) {
    return null;
  }

  let hasKitchenWork = false;

  for (const item of items) {
    const rows = rowsForItem(item, kitchenRowsByOrderItemId);
    if (rows.length === 0) {
      continue;
    }

    hasKitchenWork = true;

    const hasIncomplete = rows.some(
      (row) => row.status && INCOMPLETE_KITCHEN_STATUSES.has(row.status)
    );
    if (hasIncomplete) {
      return 'running';
    }
  }

  if (!hasKitchenWork) {
    return 'ready';
  }

  return 'ready';
}

export function getReadyAt(
  order: Order,
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId
): DateTime {
  const items = getOrderFilteredItems(order);
  const timestamps: DateTime[] = [];

  for (const item of items) {
    const rows = rowsForItem(item, kitchenRowsByOrderItemId);
    for (const row of rows) {
      if (row.completed_at) {
        timestamps.push(toLuxonDateTime(row.completed_at));
      }
    }
  }

  if (timestamps.length > 0) {
    return DateTime.max(...timestamps);
  }

  return toLuxonDateTime(order.created_at);
}

/**
 * A ready order already handed to the guest. It counts again as ready once the kitchen
 * finishes something after that (items added later).
 */
export function isServedSince(order: Order, readyAt: DateTime): boolean {
  if (!order.served_at) {
    return false;
  }
  return toLuxonDateTime(order.served_at).toMillis() >= readyAt.toMillis();
}

export function partitionDisplayOrders(
  orders: Order[],
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId,
  maxVisible = ORDER_DISPLAY_MAX_VISIBLE
): { preparing: Order[]; ready: Order[] } {
  const preparing: Order[] = [];
  const ready: { order: Order; readyAt: DateTime }[] = [];

  for (const order of orders) {
    try {
      const column = classifyOrder(order, kitchenRowsByOrderItemId);
      if (column === 'running') {
        preparing.push(order);
      } else if (column === 'ready') {
        const readyAt = getReadyAt(order, kitchenRowsByOrderItemId);
        if (!isServedSince(order, readyAt)) {
          ready.push({ order, readyAt });
        }
      }
    } catch (error) {
      console.error('Order display classify failed', order?.id, error);
    }
  }

  preparing.sort(
    (a, b) =>
      toLuxonDateTime(a.created_at).toMillis() - toLuxonDateTime(b.created_at).toMillis()
  );

  ready.sort((a, b) => b.readyAt.toMillis() - a.readyAt.toMillis());

  return {
    preparing: preparing.slice(0, maxVisible),
    ready: ready.slice(0, maxVisible).map((entry) => entry.order),
  };
}

export type KitchenStationStatus = {
  kitchenId: string;
  kitchenName: string;
  ready: boolean;
};

/** Per-station progress for an order (which kitchens finished their part). */
export function getKitchenStationStatuses(
  order: Order,
  kitchenRowsByOrderItemId: KitchenRowsByOrderItemId
): KitchenStationStatus[] {
  const items = getOrderFilteredItems(order);
  const byKitchen = new Map<string, { kitchenName: string; ready: boolean }>();

  for (const item of items) {
    const rows = rowsForItem(item, kitchenRowsByOrderItemId);
    for (const row of rows) {
      const kitchen = row.kitchen as unknown;
      const kitchenId =
        kitchen != null && typeof kitchen === 'object'
          ? kitchenOrderItemKey((kitchen as { id?: unknown }).id ?? kitchen)
          : kitchenOrderItemKey(kitchen);
      if (!kitchenId) {
        continue;
      }

      const kitchenName =
        kitchen != null && typeof kitchen === 'object' && 'name' in (kitchen as object)
          ? String((kitchen as { name?: string }).name ?? kitchenId)
          : kitchenId;
      const incomplete = Boolean(row.status && INCOMPLETE_KITCHEN_STATUSES.has(row.status));
      const existing = byKitchen.get(kitchenId);
      if (!existing) {
        byKitchen.set(kitchenId, { kitchenName, ready: !incomplete });
      } else if (incomplete) {
        existing.ready = false;
      }
    }
  }

  return [...byKitchen.entries()].map(([kitchenId, value]) => ({
    kitchenId,
    kitchenName: value.kitchenName,
    ready: value.ready,
  }));
}
