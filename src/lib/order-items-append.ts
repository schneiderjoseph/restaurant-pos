import type { useDB } from '@/api/db/db.ts';
import { toRecordId } from '@/lib/utils.ts';

type DbClient = ReturnType<typeof useDB>;

/**
 * Append line ids onto `order.items` without replacing the array.
 *
 * A full `MERGE { items }` from one cart wipes lines another server added
 * since this session loaded the order (kitchen/BAR still get them; the fiche
 * does not). `array::union` keeps existing ids and adds only the new ones.
 */
export const appendItemsToOrder = async (
  db: DbClient,
  orderId: unknown,
  newItemIds: unknown[],
): Promise<void> => {
  if (!newItemIds.length) {
    return;
  }
  await db.query(
    `UPDATE $id SET items = array::union(items ?? [], $newItems), updated_at = time::now()`,
    {
      id: toRecordId(orderId),
      newItems: newItemIds.map((id) => toRecordId(id)),
    },
  );
};

/** Pure helper for tests: same union semantics as the Surreal update. */
export const unionOrderItemIds = (
  existingIds: string[],
  newIds: string[],
): string[] => {
  const seen = new Set(existingIds);
  const out = [...existingIds];
  for (const id of newIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
};
