import { DateTime as LuxonDateTime } from 'luxon';
import { Tables } from '@/api/db/tables.ts';
import { Duo, DuoStatus } from '@/api/model/duo.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItem } from '@/api/model/order_item.ts';
import type { Shift } from '@/api/model/shift.ts';
import type { User } from '@/api/model/user.ts';
import { calculateOrderItemPrice } from '@/lib/cart.ts';
import { nowInAppTimezone, toLuxonDateTime, toSurrealDateTime } from '@/lib/datetime.ts';
import { getOrderFilteredItems } from '@/lib/order.ts';
import { recordKey } from '@/lib/kitchen/routing.ts';
import { toRecordId } from '@/lib/utils.ts';

/** A duo lasts until the end of its service plus this, for the guests who stay late. */
export const DUO_GRACE_HOURS = 2;
/** "Extend" on the end announcement keeps the duo this much longer, then asks again. */
export const DUO_EXTEND_HOURS = 1;
/** The end announcement ends the duo by itself after this long. */
export const DUO_AUTO_END_SECONDS = 10;
/** An invitation nobody answered within this is dropped. */
export const DUO_INVITE_TTL_MINUTES = 2;
/**
 * A duo whose end passed this long ago with nobody to answer (both terminals off) is ended by
 * the next terminal that sees it.
 */
export const DUO_STALE_AFTER_SECONDS = 60;

/** `table:id` of a record link or of a fetched record (same as order-edit-request's refKey). */
const refKey = (value: unknown): string => {
  const key = recordKey(value);
  return key && key !== '[object Object]' ? key : recordKey((value as { id?: unknown })?.id);
};

type ShiftTimes = Pick<Shift, 'start_time' | 'end_time'>;

const toMinutes = (time?: string): number | null => {
  if (!time) {
    return null;
  }
  const [hours, minutes] = String(time).split(':').map(Number);
  if (!Number.isFinite(hours)) {
    return null;
  }
  return hours * 60 + (Number.isFinite(minutes) ? minutes : 0);
};

/**
 * The end of the occurrence of this service that `now` falls in, counting the grace before its
 * start and after its end (a server who signs in early, or guests who stay); null when `now` is
 * outside every occurrence. A service whose end is not after its start ends the next day.
 */
export const shiftEndCovering = (shift: ShiftTimes, now: LuxonDateTime): LuxonDateTime | null => {
  const start = toMinutes(shift.start_time);
  const end = toMinutes(shift.end_time);
  if (start === null || end === null) {
    return null;
  }
  const overnight = end <= start;
  const today = now.startOf('day');
  for (const offset of [-1, 0]) {
    const day = today.plus({ days: offset });
    const startsAt = day.plus({ minutes: start });
    const endsAt = day.plus({ days: overnight ? 1 : 0, minutes: end });
    if (startsAt.minus({ hours: DUO_GRACE_HOURS }) <= now && now < endsAt.plus({ hours: DUO_GRACE_HOURS })) {
      return endsAt;
    }
  }
  return null;
};

/**
 * When a duo formed now ends: the latest end of the two servers' services (Manage → Services)
 * that `now` falls in, plus the grace. A server with no service of their own, or outside it,
 * falls back to the services running now; with none either, the duo ends at midnight.
 */
export const computeDuoEndsAt = (
  now: LuxonDateTime,
  memberShifts: Array<ShiftTimes | null | undefined>,
  allShifts: ShiftTimes[],
): LuxonDateTime => {
  const latest = (shifts: Array<ShiftTimes | null | undefined>) =>
    shifts
      .filter((shift): shift is ShiftTimes => !!shift)
      .map((shift) => shiftEndCovering(shift, now))
      .filter((end): end is LuxonDateTime => end !== null)
      .reduce<LuxonDateTime | null>((max, end) => (max === null || end > max ? end : max), null);

  const end = latest(memberShifts) ?? latest(allShifts);
  return end ? end.plus({ hours: DUO_GRACE_HOURS }) : now.startOf('day').plus({ days: 1 });
};

export const duoMemberIds = (duo: Pick<Duo, 'inviter' | 'partner'> | null | undefined): string[] =>
  duo ? [refKey(duo.inviter), refKey(duo.partner)].filter(Boolean) : [];

export const duoPartnerId = (duo: Pick<Duo, 'inviter' | 'partner'>, userId: string): string =>
  refKey(duo.inviter) === userId ? refKey(duo.partner) : refKey(duo.inviter);

export const duoPartnerOf = (duo: Pick<Duo, 'inviter' | 'partner'>, userId: string): User | undefined => {
  const partner = refKey(duo.inviter) === userId ? duo.partner : duo.inviter;
  return partner && typeof partner === 'object' && 'first_name' in partner ? (partner as User) : undefined;
};

export const userName = (user?: Partial<User> | null): string =>
  `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || user?.login || '';

const endsAtMs = (duo: Pick<Duo, 'ends_at'>): number | null =>
  duo.ends_at ? toLuxonDateTime(duo.ends_at).toMillis() : null;

/** Active and not past its end (the end announcement is still open, or will be). */
export const isDuoRunning = (duo: Pick<Duo, 'status' | 'ends_at'>, nowMs: number): boolean => {
  const end = endsAtMs(duo);
  return duo.status === DuoStatus.active && end !== null
    && nowMs < end + (DUO_AUTO_END_SECONDS + DUO_STALE_AFTER_SECONDS) * 1000;
};

/** Its end has come: both terminals announce it and the duo ends unless someone extends it. */
export const isDuoEnding = (duo: Pick<Duo, 'status' | 'ends_at'>, nowMs: number): boolean => {
  const end = endsAtMs(duo);
  return isDuoRunning(duo, nowMs) && end !== null && nowMs >= end;
};

/** Active, but its end passed long ago with no terminal to end it. */
export const isDuoStale = (duo: Pick<Duo, 'status' | 'ends_at'>, nowMs: number): boolean =>
  duo.status === DuoStatus.active && !isDuoRunning(duo, nowMs);

export const isInviteLive = (duo: Pick<Duo, 'status' | 'created_at'>, nowMs: number): boolean =>
  duo.status === DuoStatus.pending
  && toLuxonDateTime(duo.created_at).toMillis() + DUO_INVITE_TTL_MINUTES * 60_000 > nowMs;

/** The two servers of the duo that worked this order (`duo` fetched), else none. */
export const orderDuoMembers = (order: Pick<Order, 'duo'>): string[] => {
  const duo = order.duo as Duo | undefined;
  return duo && typeof duo === 'object' && 'inviter' in duo ? duoMemberIds(duo) : [];
};

/** Who sold a line of this order: in a duo whichever of the two added it, else the order's server. */
export const orderLineSeller = (order: Pick<Order, 'user' | 'duo'>) => {
  const owner = refKey(order.user);
  const members = orderDuoMembers(order);
  return (item: Pick<OrderItem, 'created_by'>): string => {
    const creator = refKey(item.created_by);
    return members.includes(creator) ? creator : owner;
  };
};

/**
 * Who an order's sales belong to, as shares adding up to 1. Outside a duo the whole order is
 * its server's. In a duo every line counts for whichever of the two added it, even on an order
 * the other one opened; a line added by anyone else counts for the order's server.
 * Needs `items` and `duo` fetched.
 */
export const orderSalesShares = (order: Pick<Order, 'user' | 'items' | 'duo'>): Map<string, number> => {
  const owner = refKey(order.user);
  if (orderDuoMembers(order).length === 0) {
    return new Map([[owner, 1]]);
  }

  const sellerOf = orderLineSeller(order);
  const totals = new Map<string, number>();
  let total = 0;
  for (const item of getOrderFilteredItems(order as Order)) {
    const seller = sellerOf(item);
    const amount = Math.max(0, Number(calculateOrderItemPrice(item)) || 0);
    totals.set(seller, (totals.get(seller) ?? 0) + amount);
    total += amount;
  }
  if (total <= 0) {
    return new Map([[owner, 1]]);
  }
  return new Map(Array.from(totals.entries()).map(([id, amount]) => [id, amount / total]));
};

/**
 * `orderSalesShares` with each seller's user record where the order holds it (`user`, and
 * `duo.inviter` / `duo.partner` when fetched), for reports that print names.
 */
export const orderSellers = (
  order: Pick<Order, 'user' | 'items' | 'duo'>,
): Array<{ userId: string; user: unknown; share: number }> => {
  const duo = order.duo as Duo | undefined;
  const known = [order.user, duo?.inviter, duo?.partner].filter((user) => user && typeof user === 'object');
  return Array.from(orderSalesShares(order).entries()).map(([userId, share]) => ({
    userId,
    user: known.find((user) => refKey(user) === userId) ?? (userId === refKey(order.user) ? order.user : userId),
    share,
  }));
};

/** An amount split by `orderSalesShares`; the rounding cent goes to the largest share. */
export const splitByShares = (amount: number, shares: Map<string, number>): Map<string, number> => {
  const entries = Array.from(shares.entries()).sort((a, b) => b[1] - a[1]);
  const result = new Map<string, number>();
  let given = 0;
  entries.slice(1).forEach(([id, share]) => {
    const part = Math.round(amount * share * 100) / 100;
    result.set(id, part);
    given += part;
  });
  if (entries.length > 0) {
    result.set(entries[0][0], Math.round((amount - given) * 100) / 100);
  }
  return result;
};

/**
 * The tip of a duo's order split between the two by their sales in it (`orderSalesShares`);
 * empty outside a duo, where the tip stays with whoever cashed the order.
 */
export const duoTipParts = (order: Pick<Order, 'user' | 'items' | 'duo' | 'tip_amount'>): Map<string, number> => {
  const tip = Number(order.tip_amount) || 0;
  if (orderDuoMembers(order).length === 0 || tip === 0) {
    return new Map();
  }
  return splitByShares(tip, orderSalesShares(order));
};

// ---------------------------------------------------------------- database

type Db = {
  query: (sql: string, vars?: Record<string, unknown>) => Promise<unknown[]>
};

const rows = <T>(result: unknown): T[] => (Array.isArray(result) ? (result as T[]) : []);

const DUO_FETCH = 'FETCH inviter, partner, inviter.user_shift, partner.user_shift';

/** This user's invitations and duo of the last day, newest first. */
export const fetchMyDuos = async (db: Db, userId: string): Promise<Duo[]> => {
  const [found] = await db.query(
    `SELECT * FROM ${Tables.duos}
     WHERE (inviter = $me OR partner = $me) AND status IN $open AND created_at >= $since
     ORDER BY created_at DESC
     ${DUO_FETCH}`,
    {
      me: toRecordId(userId),
      open: [DuoStatus.pending, DuoStatus.active],
      since: toSurrealDateTime(nowInAppTimezone().minus({ days: 1 })),
    },
  );
  return rows<Duo>(found);
};

/** Active duos of the last day (any user), to keep anyone already paired out of the invite list. */
const fetchActiveDuos = async (db: Db): Promise<Duo[]> => {
  const [found] = await db.query(
    `SELECT * FROM ${Tables.duos} WHERE status = $active AND created_at >= $since`,
    { active: DuoStatus.active, since: toSurrealDateTime(nowInAppTimezone().minus({ days: 1 })) },
  );
  return rows<Duo>(found);
};

/**
 * Users signed in on a terminal right now (a live session), other than this one, who are not
 * station accounts and not already in a running duo.
 */
export const fetchDuoCandidates = async (db: Db, userId: string): Promise<User[]> => {
  const [sessions, users] = await db.query(
    `SELECT VALUE user FROM user_session WHERE expires_at > time::now();
     SELECT * FROM ${Tables.users} WHERE deleted_at = NONE ORDER BY first_name ASC`,
  );
  const online = new Set(rows<unknown>(sessions).map(refKey));
  const nowMs = Date.now();
  const busy = new Set(
    (await fetchActiveDuos(db)).filter((duo) => isDuoRunning(duo, nowMs)).flatMap(duoMemberIds),
  );
  return rows<User>(users).filter((user) => {
    const id = refKey(user);
    return id !== userId && online.has(id) && !busy.has(id) && !user.kitchen;
  });
};

export const inviteToDuo = async (db: Db, inviterId: string, partnerId: string): Promise<void> => {
  await db.query(
    `CREATE ${Tables.duos} SET inviter = $inviter, partner = $partner, status = $pending, created_at = time::now()`,
    { inviter: toRecordId(inviterId), partner: toRecordId(partnerId), pending: DuoStatus.pending },
  );
};

export type DuoAnswer = 'accepted' | 'busy' | 'gone';

/**
 * The partner accepts: the duo starts and ends at the end of the service. Refused when either
 * of the two joined another duo meanwhile ('busy'), or the invitation is no longer open ('gone').
 * The other invitations of the two are withdrawn.
 */
export const acceptDuo = async (db: Db, duo: Duo): Promise<DuoAnswer> => {
  const members = duoMemberIds(duo);
  const nowMs = Date.now();
  const running = (await fetchActiveDuos(db))
    .filter((other) => refKey(other) !== refKey(duo) && isDuoRunning(other, nowMs));
  if (running.some((other) => duoMemberIds(other).some((id) => members.includes(id)))) {
    return 'busy';
  }

  const [shifts] = await db.query(`SELECT start_time, end_time FROM ${Tables.shifts} WHERE deleted_at = NONE`);
  const memberShifts = [duo.inviter, duo.partner].map((user) => (user as User | undefined)?.user_shift ?? null);
  const endsAt = computeDuoEndsAt(nowInAppTimezone(), memberShifts, rows<ShiftTimes>(shifts));

  const [, accepted] = await db.query(
    `UPDATE ${Tables.duos} SET status = $cancelled
       WHERE status = $pending AND id != $id AND (inviter IN $members OR partner IN $members);
     UPDATE $id SET status = $active, accepted_at = time::now(), ends_at = $endsAt
       WHERE status = $pending RETURN AFTER;`,
    {
      id: toRecordId(refKey(duo)),
      members: members.map(toRecordId),
      pending: DuoStatus.pending,
      active: DuoStatus.active,
      cancelled: DuoStatus.cancelled,
      endsAt: toSurrealDateTime(endsAt),
    },
  );
  return rows(accepted).length > 0 ? 'accepted' : 'gone';
};

const setPendingStatus = async (db: Db, duo: Duo, status: DuoStatus): Promise<void> => {
  await db.query(`UPDATE $id SET status = $status WHERE status = $pending`, {
    id: toRecordId(refKey(duo)),
    status,
    pending: DuoStatus.pending,
  });
};

export const declineDuo = (db: Db, duo: Duo) => setPendingStatus(db, duo, DuoStatus.declined);

export const cancelDuoInvite = (db: Db, duo: Duo) => setPendingStatus(db, duo, DuoStatus.cancelled);

/**
 * Ends a running duo. With `seenEndsAt` (the end announcement), only if nobody extended it
 * meanwhile: the other terminal may have pressed "Extend" first.
 */
export const endDuo = async (db: Db, duo: Duo, userId: string | null, seenEndsAt?: unknown): Promise<boolean> => {
  const [ended] = await db.query(
    `UPDATE $id SET status = $ended, ended_at = time::now(), ended_by = $by
       WHERE status = $active ${seenEndsAt ? 'AND ends_at = $seen' : ''} RETURN AFTER`,
    {
      id: toRecordId(refKey(duo)),
      ended: DuoStatus.ended,
      active: DuoStatus.active,
      by: userId ? toRecordId(userId) : null,
      // Surreal rejects an undefined variable; the record's own datetime compares exactly.
      ...(seenEndsAt ? { seen: seenEndsAt } : {}),
    },
  );
  return rows(ended).length > 0;
};

/** "Extend" on the end announcement: one more hour from now, then the announcement comes back. */
export const extendDuo = async (db: Db, duo: Duo, seenEndsAt: unknown): Promise<boolean> => {
  const [extended] = await db.query(
    `UPDATE $id SET ends_at = $until WHERE status = $active AND ends_at = $seen RETURN AFTER`,
    {
      id: toRecordId(refKey(duo)),
      active: DuoStatus.active,
      seen: seenEndsAt,
      until: toSurrealDateTime(nowInAppTimezone().plus({ hours: DUO_EXTEND_HOURS })),
    },
  );
  return rows(extended).length > 0;
};
