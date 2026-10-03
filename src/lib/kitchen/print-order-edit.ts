import { Tables } from "@/api/db/tables.ts";
import { Kitchen } from "@/api/model/kitchen.ts";
import { OrderItem } from "@/api/model/order_item.ts";
import { OrderVoidReason } from "@/api/model/order_void.ts";
import { SentLineChange } from "@/api/model/order_edit_request.ts";
import { fetchOrderFull } from "@/lib/order-fetch.ts";
import { dispatchPrint } from "@/lib/print.service.ts";
import { kitchenMatchesDish } from "@/lib/kitchen/routing.ts";
import {
  formatKitchenGuestLabel,
  formatKitchenPlaceLabel,
} from "@/lib/kitchen-ticket-label.ts";
import { toRecordId } from "@/lib/utils.ts";

/**
 * Tells the kitchens what an approved change did to lines they already hold: a deletion
 * ticket for the lines removed, a "modified" ticket with the new state of the lines changed.
 * Same kitchen match as the duplicate and deletion tickets; kitchens without a printer are skipped.
 */
export async function printApprovedOrderEdit(opts: {
  db: any;
  orderId: unknown;
  changes: SentLineChange[];
  userId?: string | { id?: string; toString?: () => string } | null;
  title?: string;
  guestLabelMode?: 'name' | 'code' | 'both';
  placeLabels?: { room: string; table: string };
}): Promise<boolean> {
  const { db, changes, userId } = opts;
  if (changes.length === 0) {
    return false;
  }

  const order = await fetchOrderFull(db, opts.orderId);
  if (!order) {
    return false;
  }

  // Read the lines again: a removed line is no longer in `order.items`.
  const [rows]: [OrderItem[]] = await db.query(
    `SELECT * FROM ${Tables.order_items} WHERE id INSIDE $ids FETCH item`,
    { ids: changes.map((change) => toRecordId(change.order_item)) }
  );
  const lineById = new Map((rows ?? []).map((line) => [line.id.toString(), line]));

  const [kitchens]: [Kitchen[]] = await db.query(
    `SELECT * FROM ${Tables.kitchens} WHERE deleted_at = none FETCH printers, items`
  );

  const placeLabels = opts.placeLabels ?? { room: 'Room', table: 'Table' };
  const guestLabel = formatKitchenGuestLabel(order.customer, opts.guestLabelMode ?? 'name');
  const placeLabel = formatKitchenPlaceLabel(order.table, placeLabels);
  const placeKind = order.table?.source === 'asi-room' ? 'room' : 'table';
  const printOptions = (kitchen: Kitchen) => ({
    title: opts.title ?? "Kitchen print",
    copies: 1,
    userId,
    printers: kitchen.printers,
  });

  const jobs: Promise<boolean>[] = [];
  for (const kitchen of kitchens ?? []) {
    if (!kitchen.printers?.length) {
      continue;
    }
    const linesFor = (action: SentLineChange['action']) =>
      changes
        .filter((change) => change.action === action)
        .map((change) => lineById.get(change.order_item))
        .filter((line): line is OrderItem =>
          !!line && kitchenMatchesDish(kitchen, line.item?.id?.toString()));

    const removed = linesFor('void');
    if (removed.length > 0) {
      jobs.push(dispatchPrint(db, 'deletion', {
        items: removed,
        order,
        kitchenName: kitchen.name,
        table: order.table,
        reason: OrderVoidReason.PunchByMistake,
      }, printOptions(kitchen)));
    }

    const modified = linesFor('update');
    if (modified.length > 0) {
      jobs.push(dispatchPrint(db, 'kitchen', {
        items: modified,
        order,
        kitchenName: kitchen.name,
        table: order.table,
        guestLabel,
        placeLabel,
        placeKind,
        modified: true,
        // A printer service older than the "modified" banner prints this as a copy, not as new.
        duplicate: true,
      }, printOptions(kitchen)));
    }
  }

  await Promise.all(jobs);
  return jobs.length > 0;
}
