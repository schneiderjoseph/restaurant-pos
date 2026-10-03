import { DateTime } from 'luxon';
import { getAppTimezone, nowInAppTimezone } from '@/lib/datetime.ts';

export type DepartureRelative = 'today' | 'past' | 'future';

export type GuestDeparture = {
  /** Calendar date in the app timezone (start of day). */
  date: DateTime;
  relative: DepartureRelative;
};

/**
 * Parse an ASI departure day (`YYYY-MM-DD`) as a calendar date in the app timezone.
 * Never use `new Date('YYYY-MM-DD')` — that shifts the day in negative UTC offsets.
 */
export function parseGuestDepartureDate(
  value: string | null | undefined,
): DateTime | null {
  if (value == null || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const date = DateTime.fromISO(trimmed, { zone: getAppTimezone() });
  return date.isValid ? date.startOf('day') : null;
}

/**
 * Informational departure relative to "today" in the app timezone.
 * Returns null when the value is missing or not a valid calendar date.
 */
export function getGuestDeparture(
  asiDateOut: string | null | undefined,
  now: DateTime = nowInAppTimezone(),
): GuestDeparture | null {
  const date = parseGuestDepartureDate(asiDateOut);
  if (!date) {
    return null;
  }
  const today = now.setZone(getAppTimezone()).startOf('day');
  const dateIso = date.toISODate();
  const todayIso = today.toISODate();
  if (dateIso === todayIso) {
    return { date, relative: 'today' };
  }
  if (date < today) {
    return { date, relative: 'past' };
  }
  return { date, relative: 'future' };
}
