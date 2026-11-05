import {describe, expect, it} from 'vitest';
import {DateTime} from 'luxon';
import {fiscalMonthIndex, fiscalYearLabel, fiscalYearRange, fiscalYearStart, normalizeFiscalStartMonth} from '@/lib/fiscal-year.ts';

const zone = 'America/Port-au-Prince';
const d = (iso: string) => DateTime.fromISO(iso, {zone});

describe('fiscal year', () => {
  it('runs October to September by default', () => {
    expect(normalizeFiscalStartMonth(undefined)).toBe(10);
    expect(normalizeFiscalStartMonth('13')).toBe(10);
    expect(normalizeFiscalStartMonth('7')).toBe(7);
  });

  it('starts in the previous calendar year before the start month', () => {
    expect(fiscalYearStart(d('2026-09-30T23:00'), 10).toISODate()).toBe('2025-10-01');
    expect(fiscalYearStart(d('2026-10-01T00:00'), 10).toISODate()).toBe('2026-10-01');
    expect(fiscalYearStart(d('2026-05-10T12:00'), 1).toISODate()).toBe('2026-01-01');
  });

  it('gives the current and previous ranges and their labels', () => {
    const now = d('2026-11-05T08:00');
    const cur = fiscalYearRange(now, 10);
    expect(cur.start.toISODate()).toBe('2026-10-01');
    expect(cur.end.toISODate()).toBe('2027-09-30');
    expect(cur.end.hour).toBe(23);
    const prev = fiscalYearRange(now, 10, -1);
    expect([prev.start.toISODate(), prev.end.toISODate()]).toEqual(['2025-10-01', '2026-09-30']);
    expect(fiscalYearLabel(prev.start)).toBe('2025-2026');
    expect(fiscalYearLabel(fiscalYearStart(now, 1))).toBe('2026');
  });

  it('numbers months from the start of the fiscal year', () => {
    expect(fiscalMonthIndex(d('2026-10-15'), 10)).toBe(0);
    expect(fiscalMonthIndex(d('2026-09-15'), 10)).toBe(11);
    expect(fiscalMonthIndex(d('2026-01-15'), 10)).toBe(3);
  });
});
