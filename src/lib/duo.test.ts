import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import type { Order } from '@/api/model/order.ts';
import { DuoStatus } from '@/api/model/duo.ts';
import {
  computeDuoEndsAt,
  isDuoEnding,
  isDuoRunning,
  isDuoStale,
  isInviteLive,
  orderSalesShares,
  orderSellers,
  sharedTipParts,
  shiftEndCovering,
  splitByShares,
} from '@/lib/duo.ts';

const at = (iso: string) => DateTime.fromISO(iso, { zone: 'America/Port-au-Prince' });

const evening = { start_time: '17:00', end_time: '23:00' };
const lunch = { start_time: '11:00', end_time: '15:00' };
const night = { start_time: '20:00', end_time: '02:00' };

describe('shiftEndCovering', () => {
  it('gives the end of the service running now', () => {
    expect(shiftEndCovering(evening, at('2026-10-07T19:30'))?.toISO()).toBe(at('2026-10-07T23:00').toISO());
  });

  it('counts the two hours before the start and after the end', () => {
    expect(shiftEndCovering(evening, at('2026-10-07T15:30'))?.toISO()).toBe(at('2026-10-07T23:00').toISO());
    expect(shiftEndCovering(evening, at('2026-10-08T00:30'))?.toISO()).toBe(at('2026-10-07T23:00').toISO());
    expect(shiftEndCovering(evening, at('2026-10-08T01:30'))).toBeNull();
  });

  it('ends an overnight service the next day, also when now is after midnight', () => {
    expect(shiftEndCovering(night, at('2026-10-07T22:00'))?.toISO()).toBe(at('2026-10-08T02:00').toISO());
    expect(shiftEndCovering(night, at('2026-10-08T01:00'))?.toISO()).toBe(at('2026-10-08T02:00').toISO());
  });

  it('ignores a service outside its window', () => {
    expect(shiftEndCovering(lunch, at('2026-10-07T20:00'))).toBeNull();
  });
});

describe('computeDuoEndsAt', () => {
  it('ends two hours after the later service of the two', () => {
    const end = computeDuoEndsAt(at('2026-10-07T15:30'), [lunch, evening], []);
    expect(end.toISO()).toBe(at('2026-10-08T01:00').toISO());
  });

  it('falls back to the services running now when the two have none of their own', () => {
    const end = computeDuoEndsAt(at('2026-10-07T12:00'), [null, undefined], [lunch, evening]);
    expect(end.toISO()).toBe(at('2026-10-07T17:00').toISO());
  });

  it('ends at midnight with no service at all', () => {
    const end = computeDuoEndsAt(at('2026-10-07T08:00'), [lunch], []);
    expect(end.toISO()).toBe(at('2026-10-08T00:00').toISO());
  });
});

describe('duo lifetime', () => {
  const endsAt = new Date('2026-10-07T23:00:00Z');
  const duo = { status: DuoStatus.active, ends_at: endsAt.toISOString() as never };
  const ms = (seconds: number) => endsAt.getTime() + seconds * 1000;

  it('runs until its end, then is announced as ending', () => {
    expect(isDuoRunning(duo, ms(-60))).toBe(true);
    expect(isDuoEnding(duo, ms(-60))).toBe(false);
    expect(isDuoEnding(duo, ms(0))).toBe(true);
    expect(isDuoEnding(duo, ms(9))).toBe(true);
  });

  it('is stale once nobody ended it well after its end', () => {
    expect(isDuoStale(duo, ms(30))).toBe(false);
    expect(isDuoStale(duo, ms(71))).toBe(true);
    expect(isDuoRunning(duo, ms(71))).toBe(false);
  });

  it('drops an invitation nobody answered within two minutes', () => {
    const invite = { status: DuoStatus.pending, created_at: endsAt.toISOString() as never };
    expect(isInviteLive(invite, ms(60))).toBe(true);
    expect(isInviteLive(invite, ms(121))).toBe(false);
  });
});

const A = 'user:a';
const B = 'user:b';
const M = 'user:manager';

const line = (createdBy: string, price: number, quantity = 1) => ({
  id: `order_item:${createdBy}${price}`,
  price,
  quantity,
  created_by: createdBy,
});

const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'order:1',
  user: { id: A, first_name: 'Ana' },
  items: [line(A, 30), line(B, 70)],
  duo: { id: 'duo:1', inviter: { id: A, first_name: 'Ana' }, partner: { id: B, first_name: 'Ben' } },
  tip_amount: 10,
  ...overrides,
}) as unknown as Order;

describe('orderSalesShares', () => {
  it('gives a whole order its server sold alone to that server', () => {
    expect(orderSalesShares(order({ items: [line(A, 30), line(A, 70)] }))).toEqual(new Map([[A, 1]]));
  });

  it('gives each of the duo the lines they added, even on the other one\'s order', () => {
    expect(orderSalesShares(order())).toEqual(new Map([[A, 0.3], [B, 0.7]]));
  });

  it('gives a colleague outside any duo the lines they added to another\'s order', () => {
    expect(orderSalesShares(order({ duo: undefined }))).toEqual(new Map([[A, 0.3], [B, 0.7]]));
  });

  it('counts a line added by anyone, a manager too, for whoever added it', () => {
    const shares = orderSalesShares(order({ items: [line(B, 50), line(M, 50)] }));
    expect(shares).toEqual(new Map([[B, 0.5], [M, 0.5]]));
  });

  it('counts an old line with no author for the order\'s server', () => {
    const shares = orderSalesShares(order({ items: [{ ...line(B, 50), created_by: undefined }, line(B, 50)] }));
    expect(shares).toEqual(new Map([[A, 0.5], [B, 0.5]]));
  });

  it('names both sellers when the duo is fetched', () => {
    const sellers = orderSellers(order());
    expect(sellers.map(({ user, share }) => [(user as { first_name: string }).first_name, share]))
      .toEqual([['Ana', 0.3], ['Ben', 0.7]]);
  });

  it('names a colleague from the fetched line author', () => {
    const ben = { id: B, first_name: 'Ben' };
    const sellers = orderSellers(order({ duo: undefined, items: [line(A, 30), { ...line(B, 70), created_by: ben }] }));
    expect(sellers.map(({ user, share }) => [(user as { first_name: string }).first_name, share]))
      .toEqual([['Ana', 0.3], ['Ben', 0.7]]);
  });
});

describe('shared tips', () => {
  it('splits the tip by each server\'s sales in the order', () => {
    expect(sharedTipParts(order())).toEqual(new Map([[B, 7], [A, 3]]));
    expect(sharedTipParts(order({ duo: undefined }))).toEqual(new Map([[B, 7], [A, 3]]));
  });

  it('leaves a tip one server sold alone to whoever cashed it', () => {
    expect(sharedTipParts(order({ items: [line(A, 30), line(A, 70)] })).size).toBe(0);
  });

  it('keeps every cent: the rounding goes to the larger share', () => {
    const parts = splitByShares(10, new Map([[A, 1 / 3], [B, 2 / 3]]));
    expect(parts.get(A)).toBe(3.33);
    expect(parts.get(B)).toBe(6.67);
  });
});
