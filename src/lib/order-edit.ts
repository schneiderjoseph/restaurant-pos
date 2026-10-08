import { MenuItem, MenuItemType } from '@/api/model/cart_item.ts';
import { Order, OrderStatus } from '@/api/model/order.ts';
import type { OrderItem } from '@/api/model/order_item.ts';
import { orderIdToString } from '@/store/order-edit-session.ts';
import { nanoid } from 'nanoid';

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
      variant: item.variant ?? undefined,
      measureQuantity: item.measure_quantity ?? undefined,
      level: item.level,
      quantity: item.quantity,
      seat: item.seat != null && item.seat !== '' ? String(item.seat) : undefined,
      id: item.id,
      selectedGroups: (item.modifiers || []) as MenuItem['selectedGroups'],
      newOrOld: MenuItemType.old,
      created_at: item.created_at,
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

/**
 * A sent line whose quantity went up (its + button, or the same dish added again from the menu)
 * keeps the quantity already sent; the extra plates become a new line, so they reach the kitchen
 * and print as an add-on like any other addition. A lower quantity stays an edit of the line.
 */
export function splitSentQuantityIncreases(
  originals: readonly OrderItem[] | null | undefined,
  cart: readonly MenuItem[],
): MenuItem[] {
  const sent = new Map(
    (originals ?? [])
      .filter((orig) => orig && !orig.deleted_at)
      .map((orig) => [orderIdToString(orig.id), orig]),
  );

  return cart.flatMap((item) => {
    const orig = item.deleted_at ? undefined : sent.get(orderIdToString(item.id));
    const sentQuantity = Number(orig?.quantity);
    const extra = Number(item.quantity) - sentQuantity;
    if (!orig || !(extra > 0)) {
      return [item];
    }

    return [
      { ...item, quantity: sentQuantity },
      {
        ...item,
        id: nanoid(),
        newOrOld: MenuItemType.new,
        quantity: extra,
        isSelected: false,
        created_at: undefined,
        updated_at: undefined,
        menu_name: item.menu_name ?? (orig as { menu?: string }).menu,
      },
    ];
  });
}
