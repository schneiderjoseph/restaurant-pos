import { DateTime } from 'luxon';

/** Minutes offered as one-tap "in X" choices when a server sets when an order is wanted. */
export const DUE_QUICK_OFFSETS_MIN = [15, 30, 45, 60, 90, 120] as const;

/** Step of the minute stepper. */
export const DUE_MINUTE_STEP = 5;

/** `now + minutes`, rounded up to the next 5 minutes so a ticket reads 14:35, not 14:32. */
export const dueFromOffset = (now: DateTime, minutes: number): DateTime => {
  const target = now.plus({ minutes }).startOf('minute');
  const rest = target.minute % DUE_MINUTE_STEP;
  return rest === 0 ? target : target.plus({ minutes: DUE_MINUTE_STEP - rest });
};

/** A wall-clock time on today (`dayOffset` 0) or a later day, in the zone of `now`. */
export const dueFromParts = (now: DateTime, dayOffset: number, hour: number, minute: number): DateTime =>
  now.startOf('day').plus({ days: dayOffset }).set({ hour, minute });

/** A due time is only kept when it is still ahead: a past time means "as soon as possible". */
export const isDueAhead = (due: DateTime | null | undefined, now: DateTime): due is DateTime =>
  !!due && due.isValid && due.toMillis() > now.toMillis();

/**
 * Where a ticket's timer starts: when it was sent, or the due time when that is later, so an
 * order taken ahead does not read as late before the guest wants it.
 */
export const timerStartWithDue = (
  sentAt: DateTime | null | undefined,
  due: DateTime | null | undefined,
): DateTime | null => {
  const sent = sentAt && sentAt.isValid ? sentAt : null;
  if (due && due.isValid && (!sent || due.toMillis() > sent.toMillis())) {
    return due;
  }
  return sent;
};

/**
 * Short label for screens: "14:30" today, "<tomorrowLabel> 08:00" tomorrow when the caller
 * gives a label, "05/10 08:00" for any other day.
 */
export const formatDueLabel = (due: DateTime, now: DateTime, tomorrowLabel?: string): string => {
  const local = due.setZone(now.zone);
  const days = Math.round(local.startOf('day').diff(now.startOf('day'), 'days').days);
  const time = local.toFormat('HH:mm');
  if (days === 0) return time;
  if (days === 1 && tomorrowLabel) return `${tomorrowLabel} ${time}`;
  return `${local.toFormat('dd/MM')} ${time}`;
};
