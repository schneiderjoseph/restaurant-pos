import { Tables } from "@/api/db/tables.ts";
import { toRecordId } from "@/lib/utils.ts";

export const recordKey = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "object") {
    const rec = value as { tb?: string; id?: unknown; toString?: () => string };
    // Prefer full RecordId string (table:id). Never use bare .id first —
    // Surreal RecordIds expose .id without the table and break matching.
    if (typeof rec.toString === "function") {
      const asString = rec.toString();
      if (asString && asString !== "[object Object]") {
        return asString;
      }
    }
    if (rec.tb != null && rec.id != null) {
      return `${rec.tb}:${String(rec.id)}`;
    }
  }
  return String(value);
};

export const isShowsAllKitchen = (kitchen: { shows_all?: boolean | null }): boolean =>
  kitchen.shows_all === true;

/** Normalize dish refs whether FETCH'd ({id}) or raw RecordId. */
export const dishRecordKey = (item: unknown): string => {
  if (item == null) return "";
  if (typeof item === "object") {
    const rec = item as { tb?: string; id?: unknown };
    // Fetched menu_item row: has .id but usually no top-level .tb
    if (rec.id != null && rec.tb == null) {
      return recordKey(rec.id);
    }
  }
  return recordKey(item);
};

export const kitchenHasDish = (
  kitchen: { items?: unknown[] | null },
  dishId: string
): boolean => {
  const wanted = recordKey(dishId);
  if (!wanted) return false;
  return (kitchen.items ?? []).some((item) => dishRecordKey(item) === wanted);
};

export const kitchenMatchesDish = (
  kitchen: { items?: unknown[] | null; shows_all?: boolean | null },
  dishId: string | null | undefined
): boolean => {
  if (!dishId) return false;
  return isShowsAllKitchen(kitchen) || kitchenHasDish(kitchen, dishId);
};

const uniqueById = <T extends { id: unknown }>(kitchens: T[]): T[] => {
  const seen = new Set<string>();
  return kitchens.filter((kitchen) => {
    const id = recordKey(kitchen.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/**
 * Stations that own the dish, plus any "show all tickets" boards.
 * If no station owns the dish, fall back to the workflow kitchen (if any)
 * so tickets are not dropped, still including show-all boards.
 */
export const resolveRouteKitchens = <
  T extends { id: unknown; items?: unknown[] | null; shows_all?: boolean | null }
>(
  kitchens: T[],
  dishId: string,
  fallbackKitchenId?: string | null
): T[] => {
  const displays = kitchens.filter(isShowsAllKitchen);
  const stations = kitchens.filter(
    (kitchen) => !isShowsAllKitchen(kitchen) && kitchenHasDish(kitchen, dishId)
  );

  if (stations.length > 0) {
    return uniqueById([...stations, ...displays]);
  }

  const fallback = fallbackKitchenId
    ? kitchens.filter((kitchen) => recordKey(kitchen.id) === recordKey(fallbackKitchenId))
    : [];

  return uniqueById([...fallback, ...displays]);
};

export const ensureKitchenShowsAllField = async (db: { query: (sql: string) => Promise<unknown> }) => {
  await db.query(
    `DEFINE FIELD IF NOT EXISTS shows_all ON kitchen TYPE bool DEFAULT false PERMISSIONS FULL`
  );
};

const dishRecord = (item: any) => toRecordId(dishRecordKey(item));

/**
 * A station owns its dishes exclusively: saving BAR with drinks removes
 * those drinks from KITCHEN (show-all boards are left untouched).
 */
export const claimDishesForKitchen = async (
  db: { query: (sql: string, vars?: Record<string, unknown>) => Promise<unknown>; merge?: (id: unknown, data: unknown) => Promise<unknown> },
  kitchenId: string,
  dishIds: string[],
  options?: { showsAll?: boolean }
): Promise<void> => {
  if (options?.showsAll || dishIds.length === 0) {
    return;
  }

  const claimed = new Set(dishIds.map(recordKey).filter(Boolean));
  const result = await db.query(
    `SELECT id, items, shows_all FROM ${Tables.kitchens} WHERE deleted_at = none AND id != $kitchen`,
    { kitchen: toRecordId(kitchenId) }
  );

  const others = Array.isArray(result)
    ? (Array.isArray(result[0]) ? result[0] : result)
    : [];

  for (const other of others as Array<{ id: unknown; items?: unknown[]; shows_all?: boolean }>) {
    if (isShowsAllKitchen(other)) continue;
    const current = other.items ?? [];
    const next = current.filter((item) => !claimed.has(dishRecordKey(item)));
    if (next.length === current.length) continue;

    if (typeof db.merge === "function") {
      await db.merge(other.id, { items: next.map(dishRecord) });
    }
  }
};
