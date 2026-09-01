import { Tables } from "@/api/db/tables.ts";
import { Kitchen } from "@/api/model/kitchen.ts";
import { Order } from "@/api/model/order.ts";
import { getOrderFilteredItems } from "@/lib/order.ts";
import { dispatchPrint } from "@/lib/print.service.ts";
import { kitchenMatchesDish } from "@/lib/kitchen/routing.ts";
import {
  formatKitchenGuestLabel,
  formatKitchenPlaceLabel,
} from "@/lib/kitchen-ticket-label.ts";

/**
 * Re-print full-order KOT(s) grouped by kitchen dish routing (same match as
 * deletion tickets). Skips kitchens with no matching items or no printers.
 */
export async function printDuplicateKotForOrder(opts: {
  db: any;
  order: Order;
  userId?: string | { id?: string; toString?: () => string } | null;
  title?: string;
  guestLabelMode?: 'name' | 'code' | 'both';
  placeLabels?: { room: string; table: string };
}): Promise<boolean> {
  const { db, order, userId } = opts;
  const items = getOrderFilteredItems(order);
  if (items.length === 0) {
    return false;
  }

  const [kitchens]: [Kitchen[]] = await db.query(
    `SELECT * FROM ${Tables.kitchens} WHERE deleted_at = none FETCH printers, items`
  );

  if (!kitchens?.length) {
    return false;
  }

  const kitchenItemsMap: Record<string, { kitchen: Kitchen; items: any[] }> = {};

  for (const item of items) {
    for (const k of kitchens) {
      const itemDishId = item.item?.id?.toString();
      if (kitchenMatchesDish(k, itemDishId)) {
        const kId = k.id.toString();
        if (!kitchenItemsMap[kId]) {
          kitchenItemsMap[kId] = { kitchen: k, items: [] };
        }
        kitchenItemsMap[kId].items.push(item);
      }
    }
  }

  const jobs = Object.values(kitchenItemsMap).filter(
    ({ kitchen, items: kitchenItems }) =>
      kitchenItems.length > 0 && kitchen.printers?.length
  );

  if (jobs.length === 0) {
    return false;
  }

  const placeLabels = opts.placeLabels ?? { room: 'Room', table: 'Table' };
  const guestLabel = formatKitchenGuestLabel(order.customer, opts.guestLabelMode ?? 'name');
  const placeLabel = formatKitchenPlaceLabel(order.table, placeLabels);
  const placeKind = order.table?.source === 'asi-room' ? 'room' : 'table';

  await Promise.all(
    jobs.map(({ kitchen, items: kitchenItems }) =>
      dispatchPrint(
        db,
        "kitchen",
        {
          items: kitchenItems,
          order,
          kitchenName: kitchen.name,
          table: order.table,
          guestLabel,
          placeLabel,
          placeKind,
          duplicate: true,
        },
        {
          title: opts.title ?? "Kitchen print",
          copies: 1,
          userId,
          printers: kitchen.printers,
        }
      )
    )
  );

  return true;
}
