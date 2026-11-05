import type {DateTime as LuxonDateTime} from 'luxon';
import {Tables} from '@/api/db/tables.ts';

/** Global setting row: `values.start_month` = first month of the fiscal year (1 = January … 12 = December). */
export const FISCAL_YEAR_KEY = 'fiscal_year';

/** Haiti: the fiscal year runs from October 1 to September 30. */
export const DEFAULT_FISCAL_START_MONTH = 10;

export const normalizeFiscalStartMonth = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : DEFAULT_FISCAL_START_MONTH;
};

/** First instant of the fiscal year holding `date` (same zone as `date`). */
export const fiscalYearStart = (date: LuxonDateTime, startMonth: number): LuxonDateTime => {
  const month = normalizeFiscalStartMonth(startMonth);
  const year = date.month >= month ? date.year : date.year - 1;
  return date.set({year, month, day: 1}).startOf('day');
};

/**
 * Fiscal year holding `date`, moved by `offset` years (-1 = previous fiscal year).
 * `end` is the last instant of the last day.
 */
export const fiscalYearRange = (
  date: LuxonDateTime,
  startMonth: number,
  offset = 0,
): {start: LuxonDateTime; end: LuxonDateTime} => {
  const start = fiscalYearStart(date, startMonth).plus({years: offset});
  return {start, end: start.plus({years: 1}).minus({days: 1}).endOf('day')};
};

/** "2025-2026" for an October–September year starting in 2025; "2026" when the fiscal year is the calendar year. */
export const fiscalYearLabel = (start: LuxonDateTime): string =>
  start.month === 1 ? String(start.year) : `${start.year}-${start.year + 1}`;

/** Position 0–11 of `date`'s month inside its fiscal year. */
export const fiscalMonthIndex = (date: LuxonDateTime, startMonth: number): number =>
  (date.month - normalizeFiscalStartMonth(startMonth) + 12) % 12;

type DBLike = {query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>};

let cached: {value: number; at: number} | null = null;
const CACHE_MS = 60_000;

/** Fiscal start month from the global setting (October when not set). Cached for a minute. */
export const loadFiscalStartMonth = async (db: DBLike): Promise<number> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  try {
    const result = await db.query(
      `SELECT values FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1`,
      {key: FISCAL_YEAR_KEY},
    ) as Array<Array<{values?: {start_month?: unknown}}>>;
    const value = normalizeFiscalStartMonth(result?.[0]?.[0]?.values?.start_month);
    cached = {value, at: Date.now()};
    return value;
  } catch {
    return DEFAULT_FISCAL_START_MONTH;
  }
};

/** Forget the cached month after the setting changes. */
export const resetFiscalStartMonthCache = () => {
  cached = null;
};
