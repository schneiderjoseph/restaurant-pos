import { describe, expect, it, vi } from 'vitest';
import {
  StayServiceError,
  appendCustomerNote,
  assertNotAsiCustomer,
  assertStayDates,
  checkInStay,
  checkOutStay,
  settleStayRoom,
  isStayRoomSettled,
  stayRoomOutstanding,
} from '@/lib/stay.service.ts';

describe('assertNotAsiCustomer', () => {
  it('refuses ASI guests', () => {
    expect(() => assertNotAsiCustomer({ source: 'asi-fd' })).toThrow(StayServiceError);
    expect(() => assertNotAsiCustomer({ source: 'walk-in', asi_checkin_id: 9 })).toThrow(StayServiceError);
    expect(() => assertNotAsiCustomer({ source: 'walk-in', asi_guest_id: 1 })).toThrow(StayServiceError);
  });

  it('allows local / walk-in', () => {
    expect(() => assertNotAsiCustomer({ source: 'walk-in' })).not.toThrow();
    expect(() => assertNotAsiCustomer({ source: 'local', asi_checkin_id: null })).not.toThrow();
  });
});

describe('assertStayDates', () => {
  it('requires date_out >= date_in', () => {
    expect(() => assertStayDates('2026-10-08', '2026-10-07')).toThrow(StayServiceError);
    expect(() => assertStayDates('2026-10-08', '2026-10-08')).not.toThrow();
    expect(() => assertStayDates('bad', '2026-10-08')).toThrow(StayServiceError);
  });
});

describe('stayRoomOutstanding / isStayRoomSettled', () => {
  it('tracks the delta after a partial settle', () => {
    expect(stayRoomOutstanding(80, 50)).toBe(30);
    expect(isStayRoomSettled(80, 50)).toBe(false);
    expect(isStayRoomSettled(80, 80)).toBe(true);
    expect(isStayRoomSettled(0, 0)).toBe(true);
  });
});

describe('appendCustomerNote', () => {
  it('appends without wiping the previous note', () => {
    expect(appendCustomerNote('Allergie arachide', 'VIP')).toBe('Allergie arachide\nVIP');
    expect(appendCustomerNote(null, 'VIP')).toBe('VIP');
    expect(appendCustomerNote('VIP', '')).toBe('VIP');
  });
});

describe('checkInStay', () => {
  it('refuses an ASI customer before writing', async () => {
    const db = { query: vi.fn() };
    await expect(
      checkInStay(db, {
        customer: { id: 'customer:1', source: 'asi-fd', in_house: false },
        room: '12',
        dateIn: '2026-10-08',
        dateOut: '2026-10-10',
      }),
    ).rejects.toMatchObject({ code: 'asi_guest' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses when already in-house', async () => {
    const db = { query: vi.fn() };
    await expect(
      checkInStay(db, {
        customer: { id: 'customer:1', source: 'walk-in', in_house: true },
        room: '12',
        dateIn: '2026-10-08',
        dateOut: '2026-10-10',
      }),
    ).rejects.toMatchObject({ code: 'already_in_house' });
  });

  it('maps a failed transaction to room_occupied_asi after re-read', async () => {
    let asiLookups = 0;
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('BEGIN TRANSACTION')) {
          throw new Error('The query was not executed due to a failed transaction');
        }
        if (sql.includes("source = 'asi-fd'")) {
          asiLookups += 1;
          // Pre-check empty; diagnose (2nd) finds the ASI guest.
          if (asiLookups === 1) return [[]];
          return [[{ id: 'customer:asi', room: '12', source: 'asi-fd', in_house: true }]];
        }
        if (sql.includes('asi-room')) {
          return [[{ number: '12', asi_alias: '012' }]];
        }
        if (sql.includes('SELECT * FROM $id')) {
          return [[{ id: 'customer:1', source: 'walk-in', in_house: false, current_stay: null }]];
        }
        return [[]];
      }),
    };
    await expect(
      checkInStay(db, {
        customer: { id: 'customer:1', source: 'walk-in', in_house: false },
        room: '12',
        dateIn: '2026-10-08',
        dateOut: '2026-10-10',
      }),
    ).rejects.toMatchObject({ code: 'room_occupied_asi' });
  });
});

/** Room lines of 50 + 30 on the stay, and what stay_settlement holds. */
const folioDb = (settled: number[]) => {
  const writes: string[] = [];
  return {
    writes,
    query: vi.fn(async (sql: string, _params?: Record<string, unknown>) => {
      if (sql.includes('BEGIN TRANSACTION')) {
        writes.push(sql);
        return [null, null, null, { id: 'stay:1', room_key: '5', status: 'closed' }];
      }
      if (sql.includes('order_payment') && sql.includes('FETCH')) {
        return [[
          { id: 'order_payment:1', amount: 50, payment_type: { type: 'Room' } },
          { id: 'order_payment:2', amount: 30, payment_type: { type: 'Room' } },
        ]];
      }
      if (sql.includes('SELECT VALUE amount FROM stay_settlement')) {
        return [settled];
      }
      if (sql.includes('counter') || sql.includes('math::max')) {
        return [[{ max_value: 10, value: 11 }]];
      }
      return [[]];
    }),
  };
};

const openStay = { id: 'stay:1', status: 'open', customer: 'customer:1' };
const guest = { id: 'customer:1', tags: ['walk-in', 'manual-stay', 'in-house'] };

describe('checkOutStay', () => {
  it('blocks when nothing was collected', async () => {
    const db = folioDb([]);
    await expect(checkOutStay(db, { stay: openStay, customer: guest }))
      .rejects.toMatchObject({ code: 'room_unsettled' });
    expect(db.writes).toHaveLength(0);
  });

  it('blocks when the collections are below the current Room total (charge added after a settle)', async () => {
    const db = folioDb([50]);
    await expect(checkOutStay(db, { stay: openStay, customer: guest }))
      .rejects.toMatchObject({ code: 'room_unsettled' });
  });

  it('checks out once the collections cover the Room total, and re-checks inside the transaction', async () => {
    const db = folioDb([50, 30]);
    await checkOutStay(db, { stay: openStay, customer: guest });
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0]).toContain('math::sum((SELECT VALUE amount FROM stay_settlement WHERE stay = $id))');
    expect(db.writes[0]).toContain("THROW 'room_unsettled'");
  });
});

describe('settleStayRoom', () => {
  it('refuses more than what is still due', async () => {
    const db = folioDb([50]);
    await expect(settleStayRoom(db, { stay: openStay, paymentTypeId: 'payment_type:cash', amount: 40 }))
      .rejects.toMatchObject({ code: 'invalid_settle' });
  });

  it('refuses when nothing is due', async () => {
    const db = folioDb([80]);
    await expect(settleStayRoom(db, { stay: openStay, paymentTypeId: 'payment_type:cash' }))
      .rejects.toMatchObject({ code: 'nothing_to_settle' });
  });

  it('records a Paid stay-settlement order with one cash line, totals summed in the transaction', async () => {
    const db = folioDb([50]);
    await settleStayRoom(db, { stay: openStay, paymentTypeId: 'payment_type:cash' });
    const sql = db.writes[0];
    expect(sql).toContain("tags = ['stay-settlement']");
    expect(sql).toContain("status = 'Paid'");
    expect(sql).toContain('items = []');
    expect(sql).toContain('payments = [$payment.id]');
    // Never trusts the amount shown on screen: what was collected is re-summed in the TX.
    expect(sql).toContain('LET $before = math::sum(');
    expect(sql).not.toMatch(/amount = -/);
    const params = db.query.mock.calls.find(([text]) => String(text).includes('BEGIN TRANSACTION'))?.[1] as Record<string, unknown>;
    expect(params.amount).toBe(30);
    expect(params.total).toBe(80);
  });
});
