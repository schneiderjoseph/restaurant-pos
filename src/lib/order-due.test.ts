import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  dueFromOffset,
  dueFromParts,
  formatDueLabel,
  isDueAhead,
  timerStartWithDue,
} from '@/lib/order-due.ts';

const zone = 'America/Port-au-Prince';
const now = DateTime.fromISO('2026-10-03T14:32:40', { zone });

describe('dueFromOffset', () => {
  it('rounds up to the next 5 minutes', () => {
    expect(dueFromOffset(now, 15).toFormat('HH:mm:ss')).toBe('14:50:00');
    expect(dueFromOffset(now, 30).toFormat('HH:mm')).toBe('15:05');
  });

  it('keeps a time already on a 5 minute mark', () => {
    const onMark = DateTime.fromISO('2026-10-03T14:30:00', { zone });
    expect(dueFromOffset(onMark, 15).toFormat('HH:mm')).toBe('14:45');
  });

  it('crosses midnight', () => {
    const late = DateTime.fromISO('2026-10-03T23:50:00', { zone });
    expect(dueFromOffset(late, 30).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-04 00:20');
  });
});

describe('dueFromParts', () => {
  it('builds a time today or on a later day in the same zone', () => {
    expect(dueFromParts(now, 0, 19, 30).toFormat('yyyy-MM-dd HH:mm ZZ')).toBe('2026-10-03 19:30 -04:00');
    expect(dueFromParts(now, 1, 8, 0).toFormat('yyyy-MM-dd HH:mm')).toBe('2026-10-04 08:00');
  });
});

describe('isDueAhead', () => {
  it('refuses a past, missing or invalid time', () => {
    expect(isDueAhead(dueFromParts(now, 0, 9, 0), now)).toBe(false);
    expect(isDueAhead(null, now)).toBe(false);
    expect(isDueAhead(DateTime.invalid('x'), now)).toBe(false);
  });

  it('accepts a time ahead', () => {
    expect(isDueAhead(dueFromParts(now, 0, 19, 0), now)).toBe(true);
  });
});

describe('formatDueLabel', () => {
  it('shows the time alone for today', () => {
    expect(formatDueLabel(dueFromParts(now, 0, 19, 30), now, 'dem.')).toBe('19:30');
  });

  it('names tomorrow, and dates any other day', () => {
    expect(formatDueLabel(dueFromParts(now, 1, 8, 0), now, 'dem.')).toBe('dem. 08:00');
    expect(formatDueLabel(dueFromParts(now, 1, 8, 0), now)).toBe('04/10 08:00');
    expect(formatDueLabel(dueFromParts(now, 3, 8, 0), now, 'dem.')).toBe('06/10 08:00');
  });

  it('reads a UTC instant in the local zone', () => {
    const utc = DateTime.fromISO('2026-10-03T23:30:00Z', { setZone: true });
    expect(formatDueLabel(utc, now)).toBe('19:30');
  });
});

describe('timerStartWithDue', () => {
  const sent = now;

  it('starts when the order was sent when there is no due time', () => {
    expect(timerStartWithDue(sent, null)?.toMillis()).toBe(sent.toMillis());
    expect(timerStartWithDue(sent, undefined)?.toMillis()).toBe(sent.toMillis());
  });

  it('starts at the due time when it is later than the send', () => {
    const due = dueFromParts(now, 1, 8, 0);
    expect(timerStartWithDue(sent, due)?.toMillis()).toBe(due.toMillis());
  });

  it('keeps the send time for an add-on sent after the due time', () => {
    const due = now.minus({ hours: 1 });
    expect(timerStartWithDue(sent, due)?.toMillis()).toBe(sent.toMillis());
  });

  it('ignores an unreadable due time, and has no start without either', () => {
    expect(timerStartWithDue(sent, DateTime.invalid('bad'))?.toMillis()).toBe(sent.toMillis());
    expect(timerStartWithDue(null, null)).toBeNull();
  });
});
