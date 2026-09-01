import type { AppStateInterface } from '@/store/jotai.ts';
import type { Order } from '@/api/model/order.ts';
import { orderToCartItems, seatsFromOrder } from '@/lib/order-edit.ts';
import {
  orderIdToString,
  type OrderEditSession,
} from '@/store/order-edit-session.ts';

export function buildOrderEditSession(full: Order, fallbackCustomer?: Order['customer']): OrderEditSession | null {
  const orderId = orderIdToString(full.id);
  if (!orderId || orderId === 'new') {
    return null;
  }

  const seats = seatsFromOrder(full);
  const cart = orderToCartItems(full);
  const hasUnseated = cart.some((item) => item.seat == null || item.seat === '');
  return {
    orderId,
    order: full,
    cart,
    seats,
    // Cart UI filters by exact seat — keep undefined when any line is unseated so items show.
    seat: hasUnseated ? undefined : (seats.length > 0 ? seats[0] : undefined),
    customer: (full.customer as Order['customer']) ?? fallbackCustomer,
    table: full.table,
    floor: full.floor ?? full.table?.floor,
    orderType: full.order_type,
    persons: full.covers != null ? String(full.covers) : undefined,
  };
}

/** Push edit session into memory atom + slim appState flags (safe for localStorage). */
export function commitOrderEditSession(
  set: {
    setSession: (session: OrderEditSession | null) => void;
    setAppState: (updater: (prev: AppStateInterface) => AppStateInterface) => void;
  },
  session: OrderEditSession,
) {
  set.setSession(session);
  set.setAppState((prev) => ({
    ...prev,
    showFloor: false,
    showPersons: false,
    switchTable: false,
    resortEntry: 'guest',
    table: session.table,
    customer: session.customer,
    floor: session.floor ?? prev.floor,
    orderType: session.orderType ?? prev.orderType,
    persons: session.persons ?? prev.persons,
    orders: [session.order],
    order: {
      id: session.orderId,
      order: session.order,
    },
    cart: session.cart,
    seats: session.seats,
    seat: session.seat,
  }));
}
