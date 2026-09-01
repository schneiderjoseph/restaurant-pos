import { MenuItem, MenuItemType } from '@/api/model/cart_item.ts';
import { Order, OrderStatus } from '@/api/model/order.ts';

/** Only unpaid / open orders can be edited in the POS cart. */
export function canEditOrder(order?: Pick<Order, 'status'> | null): boolean {
  return order?.status === OrderStatus['In Progress'];
}

/** Map a fetched order into cart lines (existing items marked as old). */
export function orderToCartItems(order?: Order | null): MenuItem[] {
  if (!order?.items?.length) {
    return [];
  }

  return order.items
    .filter((item) => !item.deleted_at)
    .map((item) => ({
      dish: item.item,
      level: item.level,
      quantity: item.quantity,
      seat: item.seat != null && item.seat !== '' ? String(item.seat) : undefined,
      id: item.id,
      selectedGroups: (item.modifiers || []) as MenuItem['selectedGroups'],
      newOrOld: MenuItemType.old,
      price: item.price,
      updated_at: item.updated_at,
      deleted_at: item.deleted_at,
      category: item.category,
      category_id: item.category_id,
      comments: item.comments,
      isHold: item.is_suspended,
    }));
}

export function seatsFromOrder(order?: Order | null): string[] {
  if (!order?.items?.length) {
    return [];
  }
  const seats = new Map<string, string>();
  for (const item of order.items) {
    if (item.deleted_at) {
      continue;
    }
    if (item.seat != null && item.seat !== '') {
      const seat = String(item.seat);
      seats.set(seat, seat);
    }
  }
  return Array.from(seats.values());
}
