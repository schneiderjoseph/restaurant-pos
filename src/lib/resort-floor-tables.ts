import { Tables } from '@/api/db/tables.ts';
import type { Floor } from '@/api/model/floor.ts';
import type { Table } from '@/api/model/table.ts';
import { toRecordId } from '@/lib/utils.ts';

/** Default count of numbered tables seeded for resort / ASI tablets. */
export const RESORT_TABLE_COUNT = 32;

export const RESORT_FLOOR_RECORD_ID = 'floor:resort_salle';
export const RESORT_FLOOR_NAME = 'Salle';

/** Compact grid that fits above the floor switcher (≈100vh − 160px). */
export const RESORT_TABLE_LAYOUT = {
  cols: 8,
  size: 96,
  gap: 20,
  paddingX: 24,
  paddingY: 24,
} as const;

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
  merge?: (id: unknown, data: Record<string, unknown>) => Promise<unknown>;
};

const rowsOf = <T = unknown>(result: unknown): T[] => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? (first as T[]) : [];
};

const tableRecordId = (number: number) => `floor_table:resort_t_${number}`;

export function resortTablePosition(indexZeroBased: number): {
  x: number;
  y: number;
  size: number;
} {
  const { cols, size, gap, paddingX, paddingY } = RESORT_TABLE_LAYOUT;
  const col = indexZeroBased % cols;
  const row = Math.floor(indexZeroBased / cols);
  return {
    x: paddingX + col * (size + gap),
    y: paddingY + row * (size + gap),
    size,
  };
}

let ensureInFlight: Promise<{ floor: Floor; tables: Table[] }> | null = null;
let ensureCache: { floor: Floor; tables: Table[] } | null = null;

export function invalidateResortFloorTablesCache(): void {
  ensureCache = null;
}

async function ensureResortFloor(db: AnyDb): Promise<Floor> {
  const existing = rowsOf<Floor>(
    await db.query(
      `SELECT * FROM ${Tables.floors}
       WHERE id = $id OR (name = $name AND deleted_at = none)
       LIMIT 1`,
      { id: toRecordId(RESORT_FLOOR_RECORD_ID), name: RESORT_FLOOR_NAME },
    ),
  );
  if (existing[0]?.id) {
    return existing[0];
  }

  const created = rowsOf<Floor>(
    await db.query(
      `CREATE ${RESORT_FLOOR_RECORD_ID} SET
        name = $name,
        priority = 1,
        background = '#f1f5f9',
        color = '#0f172a'`,
      { name: RESORT_FLOOR_NAME },
    ),
  );
  if (created[0]?.id) {
    return created[0];
  }

  const again = rowsOf<Floor>(
    await db.query(`SELECT * FROM ${RESORT_FLOOR_RECORD_ID}`),
  );
  if (again[0]) {
    return again[0];
  }
  throw new Error('Failed to create resort floor');
}

/** Numbers already used on this floor only (not Ground / Takeaway). */
async function existingNumbersOnFloor(
  db: AnyDb,
  floor: Floor,
): Promise<Set<string>> {
  const rows = rowsOf<{ number?: string | number | null }>(
    await db.query(
      `SELECT number FROM ${Tables.tables}
       WHERE deleted_at = none
         AND floor = $floor
         AND number != none`,
      { floor: toRecordId(floor.id) },
    ),
  );
  return new Set(
    rows
      .map((row) => String(row.number ?? '').trim())
      .filter(Boolean),
  );
}

async function createNumberedTable(
  db: AnyDb,
  floor: Floor,
  number: number,
): Promise<Table | undefined> {
  const { x, y, size } = resortTablePosition(number - 1);

  const created = rowsOf<Table>(
    await db.query(
      `CREATE ${tableRecordId(number)} SET
        name = $name,
        number = $number,
        priority = $priority,
        floor = $floor,
        ask_for_covers = false,
        allow_multiple_orders = true,
        background = '#bfdbfe',
        color = '#0f172a',
        height = $size,
        width = $size,
        x = $x,
        y = $y,
        rounded = 'rounded-xl',
        categories = [],
        order_types = [],
        payment_types = [],
        is_locked = false`,
      {
        name: 'T',
        number: String(number),
        priority: number,
        floor: toRecordId(floor.id),
        size,
        x,
        y,
      },
    ),
  );
  return created[0];
}

/** Re-pack all tables on the resort floor into a clean grid (fixes holey layouts). */
async function relayoutResortFloorTables(
  db: AnyDb,
  floor: Floor,
): Promise<void> {
  const tables = rowsOf<Table>(
    await db.query(
      `SELECT * FROM ${Tables.tables}
       WHERE deleted_at = none
         AND floor = $floor
       ORDER BY priority ASC, number ASC`,
      { floor: toRecordId(floor.id) },
    ),
  );

  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i];
    if (!table?.id) {
      continue;
    }
    const { x, y, size } = resortTablePosition(i);
    await db.query(
      `UPDATE $id SET
        x = $x,
        y = $y,
        width = $size,
        height = $size,
        background = $background,
        color = $color,
        rounded = 'rounded-xl',
        priority = $priority`,
      {
        id: toRecordId(table.id),
        x,
        y,
        size,
        background: '#bfdbfe',
        color: '#0f172a',
        priority: i + 1,
      },
    );
  }
}

async function ensureResortFloorTablesOnce(
  db: AnyDb,
  tableCount = RESORT_TABLE_COUNT,
): Promise<{ floor: Floor; tables: Table[] }> {
  if (ensureCache) {
    return ensureCache;
  }

  const floor = await ensureResortFloor(db);
  const have = await existingNumbersOnFloor(db, floor);

  for (let n = 1; n <= tableCount; n += 1) {
    const key = String(n);
    if (have.has(key)) {
      continue;
    }
    const table = await createNumberedTable(db, floor, n);
    if (table) {
      have.add(key);
    }
  }

  await relayoutResortFloorTables(db, floor);

  const tables = rowsOf<Table>(
    await db.query(
      `SELECT * FROM ${Tables.tables}
       WHERE deleted_at = none
         AND floor = $floor
       ORDER BY priority ASC, number ASC
       FETCH floor`,
      { floor: toRecordId(floor.id) },
    ),
  );

  ensureCache = { floor, tables };
  return ensureCache;
}

export async function ensureResortFloorTables(
  db: AnyDb,
  tableCount = RESORT_TABLE_COUNT,
): Promise<{ floor: Floor; tables: Table[] }> {
  // Always rebuild layout so existing holey grids get fixed after upgrades.
  ensureCache = null;

  if (ensureInFlight) {
    return ensureInFlight;
  }

  ensureInFlight = ensureResortFloorTablesOnce(db, tableCount).finally(() => {
    ensureInFlight = null;
  });
  return ensureInFlight;
}

/** Resolve a floor_table by its display number (e.g. "7" or "07"). */
export async function findTableByNumber(
  db: AnyDb,
  rawNumber: string,
): Promise<Table | undefined> {
  const trimmed = rawNumber.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = String(Number(trimmed) || trimmed);
  const candidates = Array.from(
    new Set([trimmed, normalized, trimmed.replace(/^0+/, '') || trimmed]),
  );

  const rows = rowsOf<Table>(
    await db.query(
      `SELECT * FROM ${Tables.tables}
       WHERE deleted_at = none
         AND number IN $numbers
       ORDER BY priority ASC
       LIMIT 1
       FETCH floor`,
      { numbers: candidates },
    ),
  );
  return rows[0];
}
