import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { RecordId } from 'surrealdb';
import {
  checkRoomCharge,
  isRoomPaymentType,
  loadCustomerForRoomCharge,
  ROOM_SYNC_MAX_AGE_MS,
} from '@/lib/room-charge.ts';

const now = DateTime.fromISO('2026-10-02T14:00:00', { zone: 'America/Port-au-Prince' });
const minutesAgo = (minutes: number) => now.minus({ minutes }).toJSDate().toISOString();

const inHouse = {
  source: 'asi-fd',
  in_house: true,
  asi_synced_at: minutesAgo(1),
  asi_date_out: '2026-10-05',
};

describe('checkRoomCharge', () => {
  it('allows an in-house guest with a fresh sync', () => {
    expect(checkRoomCharge(inHouse, now)).toEqual({ ok: true, departsToday: false });
  });

  it('refuses a walk-in without a manual stay, a local client or no client', () => {
    expect(checkRoomCharge({ ...inHouse, source: 'walk-in', current_stay: undefined }, now)).toEqual({
      ok: false,
      reason: 'not-hotel-guest',
    });
    expect(checkRoomCharge({ ...inHouse, source: undefined, current_stay: undefined, asi_checkin_id: null, asi_guest_id: null }, now)).toEqual({
      ok: false,
      reason: 'not-hotel-guest',
    });
    expect(checkRoomCharge(undefined, now)).toEqual({ ok: false, reason: 'not-hotel-guest' });
  });

  it('allows a walk-in with an open manual stay', () => {
    expect(
      checkRoomCharge(
        {
          source: 'walk-in',
          in_house: true,
          current_stay: 'stay:abc',
          asi_checkin_id: null,
          asi_guest_id: null,
        },
        now,
        { stayDateOut: '2026-10-02' },
      ),
    ).toEqual({ ok: true, departsToday: true, stayId: 'stay:abc' });
  });

  it('refuses a closed manual stay with a distinct reason', () => {
    expect(
      checkRoomCharge(
        {
          source: 'walk-in',
          in_house: false,
          current_stay: undefined,
          tags: ['walk-in', 'manual-stay', 'checked-out'],
          asi_checkin_id: null,
          asi_guest_id: null,
        },
        now,
      ),
    ).toEqual({ ok: false, reason: 'manual-stay-closed' });
  });

  it('refuses a guest whose stay is closed in ASI: they pay like a walk-in', () => {
    expect(checkRoomCharge({ ...inHouse, in_house: false }, now)).toEqual({ ok: false, reason: 'checked-out' });
  });

  it('refuses when the last sync is too old to trust', () => {
    const stale = { ...inHouse, asi_synced_at: minutesAgo(ROOM_SYNC_MAX_AGE_MS / 60000 + 1) };
    expect(checkRoomCharge(stale, now)).toEqual({ ok: false, reason: 'sync-stale' });
  });

  it('refuses when the stay was never synced (no date means unknown, not fresh)', () => {
    expect(checkRoomCharge({ ...inHouse, asi_synced_at: undefined }, now)).toEqual({ ok: false, reason: 'sync-stale' });
  });

  it('flags a departure today without blocking it: ASI decides the check-out', () => {
    expect(checkRoomCharge({ ...inHouse, asi_date_out: '2026-10-02' }, now)).toEqual({ ok: true, departsToday: true });
  });
});

describe('isRoomPaymentType', () => {
  it('matches the Room tender only', () => {
    expect(isRoomPaymentType({ type: 'Room' })).toBe(true);
    expect(isRoomPaymentType({ type: 'room' })).toBe(true);
    expect(isRoomPaymentType({ type: 'Cash' })).toBe(false);
    expect(isRoomPaymentType(undefined)).toBe(false);
  });
});

describe('loadCustomerForRoomCharge', () => {
  const dbReturning = (calls: unknown[]) => ({
    query: async (_sql: string, params?: Record<string, unknown>) => {
      calls.push(params?.id);
      return [[{ id: 'customer:asi_fd_7', in_house: false }]];
    },
  });

  it('reads the customer of a fetched order from the database', async () => {
    const calls: unknown[] = [];
    const customer = await loadCustomerForRoomCharge(dbReturning(calls), {
      id: new RecordId('customer', 'asi_fd_7'),
      in_house: true,
    });
    expect(customer?.in_house).toBe(false);
    expect(String(calls[0])).toBe('customer:asi_fd_7');
  });

  it('accepts a bare record id without mistaking its inner id for the record', async () => {
    const calls: unknown[] = [];
    await loadCustomerForRoomCharge(dbReturning(calls), new RecordId('customer', 'asi_fd_7'));
    expect(String(calls[0])).toBe('customer:asi_fd_7');
  });

  it('accepts a string record id', async () => {
    const calls: unknown[] = [];
    await loadCustomerForRoomCharge(dbReturning(calls), 'customer:asi_fd_7');
    expect(String(calls[0])).toBe('customer:asi_fd_7');
  });

  it('returns nothing without a customer', async () => {
    const calls: unknown[] = [];
    expect(await loadCustomerForRoomCharge(dbReturning(calls), undefined)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
