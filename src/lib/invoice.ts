import {Tables} from "@/api/db/tables.ts";

type QueryableDb = {
  query: <R extends unknown[] = any[]>(sql: string, parameters?: Record<string, unknown>) => Promise<R>;
};

type MaxRow = {
  max_value?: number | null;
};

/** Single global counter — invoice_number never resets per business day. */
const GLOBAL_INVOICE_COUNTER_KEY = 'invoice_global';

const asFiniteNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.floor(n);
};

/**
 * Walk query result (nested arrays/objects) for a numeric counter value.
 * Prefer the last finite number found.
 */
const extractAllocatedValue = (result: unknown): number | null => {
  let lastNumber: number | null = null;

  const visit = (node: unknown): void => {
    if (typeof node === "number" && Number.isFinite(node)) {
      lastNumber = Math.floor(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === "object") {
      const record = node as Record<string, unknown>;
      if ("value" in record) {
        visit(record.value);
      }
      Object.values(record).forEach(visit);
    }
  };

  visit(result);
  return lastNumber != null && lastNumber > 0 ? lastNumber : null;
};

/**
 * Atomically raise counter floor to seed, then increment.
 * A single UPSERT statement is one Surreal transaction — concurrent callers get distinct values.
 */
const allocateFromCounter = async (
  db: QueryableDb,
  counterKey: string,
  seedMax: number,
): Promise<number> => {
  const seed = Math.max(0, asFiniteNumber(seedMax, 0));
  const maxAttempts = 6;
  let lastError: unknown;
  const table = Tables.order_number_seq;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const result = await db.query(
        `UPSERT type::record('${table}', $counterKey)
         SET value = math::max([value ?? 0, $seed]) + 1
         RETURN AFTER`,
        {
          counterKey,
          seed,
        },
      );

      const allocated = extractAllocatedValue(result);
      if (allocated != null && allocated > 0) {
        return allocated;
      }

      lastError = new Error(`Counter allocate returned no value for ${counterKey}`);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to allocate counter ${counterKey}`);
};

const maxInvoiceNumber = async (db: QueryableDb): Promise<number> => {
  const [result] = await db.query<MaxRow[]>(
    `SELECT math::max(invoice_number) as max_value
     FROM ${Tables.orders}
     WHERE invoice_number != NONE
     GROUP ALL`,
  );

  return asFiniteNumber(result?.[0]?.max_value, 0);
};

const maxAutoId = async (db: QueryableDb): Promise<number> => {
  const [result] = await db.query<MaxRow[]>(
    `SELECT math::max(auto_id) as max_value
     FROM ${Tables.orders}
     GROUP ALL`,
  );

  return asFiniteNumber(result?.[0]?.max_value, 0);
};

/**
 * Next invoice number (globally unique across all orders / business days).
 * Uses an atomic DB counter so concurrent creates cannot share a number.
 */
export const generateNextInvoiceNumber = async (db: QueryableDb): Promise<number> => {
  const seed = await maxInvoiceNumber(db);
  return allocateFromCounter(db, GLOBAL_INVOICE_COUNTER_KEY, seed);
};

/**
 * Next global auto_id.
 * Uses an atomic DB counter so concurrent creates cannot share a value.
 */
export const getNextAutoId = async (db: QueryableDb): Promise<number> => {
  const seed = await maxAutoId(db);
  return allocateFromCounter(db, "auto_id", seed);
};
