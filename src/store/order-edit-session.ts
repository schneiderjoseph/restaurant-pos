import { atom, type PrimitiveAtom } from 'jotai';
import type { MenuItem } from '@/api/model/cart_item.ts';
import type { Order } from '@/api/model/order.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { Table } from '@/api/model/table.ts';
import type { Floor } from '@/api/model/floor.ts';
import type { OrderType } from '@/api/model/order_type.ts';

/**
 * In-memory only (NOT persisted). Holds a full order graph for "edit unpaid order"
 * so we never push Surreal RecordIds / deep FETCH trees through localStorage
 * (quota / serialize failures were bouncing the UI back to GuestLookup).
 */
export type OrderEditSession = {
  orderId: string;
  order: Order;
  cart: MenuItem[];
  seats: string[];
  seat?: string;
  customer?: Customer;
  table?: Table;
  floor?: Floor;
  orderType?: OrderType;
  persons?: string;
};

export const orderEditSessionAtom = atom(
  null as OrderEditSession | null,
) as PrimitiveAtom<OrderEditSession | null>;

export function orderIdToString(id: unknown): string {
  if (id == null) {
    return '';
  }
  if (typeof id === 'string') {
    return id.includes(':') ? id : `order:${id}`;
  }
  try {
    const asString = String((id as { toString?: () => string }).toString?.() ?? id);
    if (asString && asString !== '[object Object]') {
      return asString;
    }
  } catch {
    // ignore
  }
  const rec = id as { tb?: string; id?: string | number };
  if (rec?.tb && rec?.id != null) {
    return `${rec.tb}:${rec.id}`;
  }
  return '';
}
