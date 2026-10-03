import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { getGuestDeparture, parseGuestDepartureDate } from '@/lib/guest-departure.ts';

describe('parseGuestDepartureDate', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses YYYY-MM-DD in the app timezone without shifting the day', () => {
    vi.stubEnv('VITE_APP_TIMEZONE', 'America/Port-au-Prince');
    const date = parseGuestDepartureDate('2026-10-05');
    expect(date?.isValid).toBe(true);
    expect(date?.toISODate()).toBe('2026-10-05');
    expect(date?.zoneName).toBe('America/Port-au-Prince');
  });

  it('returns null for null, empty, or malformed strings', () => {
    expect(parseGuestDepartureDate(null)).toBeNull();
    expect(parseGuestDepartureDate(undefined)).toBeNull();
    expect(parseGuestDepartureDate('')).toBeNull();
    expect(parseGuestDepartureDate('  ')).toBeNull();
    expect(parseGuestDepartureDate('05/10/2026')).toBeNull();
    expect(parseGuestDepartureDate('2026-13-01')).toBeNull();
    expect(parseGuestDepartureDate('not-a-date')).toBeNull();
  });
});

describe('getGuestDeparture', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const now = DateTime.fromISO('2026-10-05T14:00:00', { zone: 'America/Port-au-Prince' });

  it('flags departure today', () => {
    vi.stubEnv('VITE_APP_TIMEZONE', 'America/Port-au-Prince');
    expect(getGuestDeparture('2026-10-05', now)).toEqual({
      date: expect.any(DateTime),
      relative: 'today',
    });
    expect(getGuestDeparture('2026-10-05', now)?.date.toISODate()).toBe('2026-10-05');
  });

  it('flags a future departure', () => {
    vi.stubEnv('VITE_APP_TIMEZONE', 'America/Port-au-Prince');
    expect(getGuestDeparture('2026-10-08', now)?.relative).toBe('future');
  });

  it('flags a past departure', () => {
    vi.stubEnv('VITE_APP_TIMEZONE', 'America/Port-au-Prince');
    expect(getGuestDeparture('2026-10-01', now)?.relative).toBe('past');
  });

  it('returns null when the date is missing or malformed', () => {
    vi.stubEnv('VITE_APP_TIMEZONE', 'America/Port-au-Prince');
    expect(getGuestDeparture(null, now)).toBeNull();
    expect(getGuestDeparture('bogus', now)).toBeNull();
  });
});
