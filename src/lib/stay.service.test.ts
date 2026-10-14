import { describe, expect, it, vi } from 'vitest';
import {
  StayServiceError,
  appendCustomerNote,
  assertNotAsiCustomer,
  assertStayDates,
  checkInStay,
  checkOutStay,
  settleStayRoom,
  isStayOverdue,
  listRoomChargedOrders,
  orderRoomLabel,
  isStayRoomSettled,
  loadInHouseRoomOccupancy,
  loadManualStayRoomContext,
  loadCustomerRoomFolioOrders,
  loadStayFolioOrders,
  orderHasRoomCharge,
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

  it('allows a second room when the guest is already in-house', async () => {
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('BEGIN TRANSACTION')) {
          return [{ id: 'stay:2', room_key: '14', room: '14', status: 'open' }];
        }
        if (sql.includes('asi-room')) return [[]];
        if (sql.includes("source = 'asi-fd'")) return [[]];
        return [[]];
      }),
    };
    await expect(
      checkInStay(db, {
        customer: {
          id: 'customer:1',
          source: 'walk-in',
          in_house: true,
          current_stay: 'stay:1',
          tags: ['manual-stay', 'in-house'],
        },
        room: '14',
        dateIn: '2026-10-08',
        dateOut: '2026-10-10',
      }),
    ).resolves.toMatchObject({ room: '14' });
    expect(db.query.mock.calls.some(([sql]) => String(sql).includes('already_in_house'))).toBe(false);
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

describe('orderHasRoomCharge', () => {
  it('detects Room tender lines', () => {
    expect(orderHasRoomCharge({
      payments: [{ amount: 10, payment_type: { type: 'Room' } }],
    } as never)).toBe(true);
    expect(orderHasRoomCharge({
      payments: [{ amount: 10, payment_type: { type: 'Cash' } }],
    } as never)).toBe(false);
  });
});

describe('loadCustomerRoomFolioOrders', () => {
  it('keeps only orders with Room payments for the guest history', async () => {
    const roomOrder = {
      id: 'order:1',
      payments: [{ amount: 50, payment_type: { type: 'Room' } }],
    };
    const cashOrder = {
      id: 'order:2',
      payments: [{ amount: 20, payment_type: { type: 'Cash' } }],
    };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('merged_into')) return [[]];
        if (sql.includes('CONTAINSANY') || sql.includes('customer IN $customers')) {
          return [[roomOrder, cashOrder]];
        }
        return [[]];
      }),
    };
    await expect(loadCustomerRoomFolioOrders(db, 'customer:asi')).resolves.toEqual([roomOrder]);
  });
});

describe('loadStayFolioOrders', () => {
  it('returns [] when the stay has no Room payments', async () => {
    const db = {
      query: vi.fn(async () => [[]]),
    };
    await expect(loadStayFolioOrders(db, 'stay:1')).resolves.toEqual([]);
  });

  it('loads active orders that contain the stay Room payments', async () => {
    const order = { id: 'order:9', invoice_number: 9, items: [], payments: ['order_payment:1'] };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('order_payment') && sql.includes('FETCH')) {
          return [[{ id: 'order_payment:1', amount: 40, payment_type: { type: 'Room' } }]];
        }
        if (sql.includes('status IN $bad')) {
          return [[]];
        }
        if (sql.includes('CONTAINSANY')) {
          return [[order]];
        }
        return [[]];
      }),
    };
    await expect(loadStayFolioOrders(db, 'stay:1')).resolves.toEqual([order]);
    const folioCall = (db.query.mock.calls as Array<[string, Record<string, unknown>?]>)
      .find(([sql]) => sql.includes('CONTAINSANY'));
    expect(folioCall?.[1]).toMatchObject({
      payments: expect.arrayContaining([expect.anything()]),
    });
  });
});

describe('loadInHouseRoomOccupancy', () => {
  it('binds F&B to the ASI guest when a manual stay is still open on that room', async () => {
    const asi = { id: 'customer:asi_fd_1', source: 'asi-fd', room: '32', name: 'Matchalie', in_house: true };
    const manual = { id: 'customer:pablo', source: 'walk-in', room: '32', name: 'Pablo', in_house: true };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("source = 'asi-fd'")) return [[asi]];
        if (sql.includes('FROM stay') || sql.includes('status = \'open\'')) {
          return [[{ id: 'stay:1', room: '32', status: 'open', customer: manual }]];
        }
        if (sql.includes('asi-room')) return [[{ number: '32', asi_alias: '32' }]];
        return [[]];
      }),
    };
    const { byRoomKey, conflictKeys, conflicts } = await loadInHouseRoomOccupancy(db);
    expect(byRoomKey.get('32')).toEqual(asi);
    expect(conflictKeys.has('32')).toBe(false);
    expect(conflicts[0]?.guests.map((g) => g.id)).toEqual(
      expect.arrayContaining([asi.id, manual.id]),
    );
  });

  it('keeps a manual stay as the occupant when ASI is not in the room', async () => {
    const manual = { id: 'customer:pablo', source: 'walk-in', room: '14', name: 'Pablo', in_house: true };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("source = 'asi-fd'")) return [[]];
        if (sql.includes('status = \'open\'')) {
          return [[{ id: 'stay:1', room: '14', status: 'open', customer: manual }]];
        }
        if (sql.includes('asi-room')) return [[]];
        return [[]];
      }),
    };
    const { byRoomKey, conflictKeys } = await loadInHouseRoomOccupancy(db);
    expect(byRoomKey.get('14')).toEqual(manual);
    expect(conflictKeys.has('14')).toBe(false);
  });
});

describe('loadManualStayRoomContext', () => {
  const dbWith = (asiInRoom: boolean, status = 'open') => ({
    query: vi.fn(async (sql: string) => {
      if (sql.startsWith('SELECT * FROM $id')) {
        return [[{ id: 'stay:1', status, room: '14', date_out: '2026-10-09', customer: 'customer:1' }]];
      }
      if (sql.includes('asi-room')) return [[]];
      if (sql.includes("source = 'asi-fd'")) {
        return [asiInRoom ? [{ id: 'customer:asi_fd_9', room: '14', source: 'asi-fd' }] : []];
      }
      return [[]];
    }),
  });

  it('flags a room ASI has taken', async () => {
    await expect(loadManualStayRoomContext(dbWith(true), { in_house: true }, 'stay:1'))
      .resolves.toEqual({ stayDateOut: '2026-10-09', asiOccupied: true });
  });

  it('leaves a room the manual stay holds alone', async () => {
    await expect(loadManualStayRoomContext(dbWith(false), { in_house: true }, 'stay:1'))
      .resolves.toEqual({ stayDateOut: '2026-10-09', asiOccupied: false });
  });

  it('says nothing for a closed stay or a guest not in house', async () => {
    await expect(loadManualStayRoomContext(dbWith(true, 'closed'), { in_house: true }, 'stay:1'))
      .resolves.toEqual({ stayDateOut: null, asiOccupied: false });
    await expect(loadManualStayRoomContext(dbWith(true), { in_house: false }, 'stay:1'))
      .resolves.toEqual({ stayDateOut: null, asiOccupied: false });
  });
});

describe('isStayOverdue', () => {
  it('flags an open stay only once its departure day is past', () => {
    expect(isStayOverdue({ status: 'open', date_out: '2026-10-12' }, '2026-10-14')).toBe(true);
    expect(isStayOverdue({ status: 'open', date_out: '2026-10-14' }, '2026-10-14')).toBe(false);
    expect(isStayOverdue({ status: 'closed', date_out: '2026-10-12' }, '2026-10-14')).toBe(false);
    expect(isStayOverdue({ status: 'open', date_out: '' }, '2026-10-14')).toBe(false);
  });
});

describe('orderRoomLabel', () => {
  it('prefers the manual stay room, then the room tile, then the guest room', () => {
    const roomType = { type: 'Room' };
    expect(orderRoomLabel({ payments: [{ amount: 1, payment_type: roomType, stay: { room: '21' } }], table: { number: '17' } } as never)).toBe('21');
    expect(orderRoomLabel({ payments: [{ amount: 1, payment_type: roomType, stay: 'stay:1' }], table: { number: '17' } } as never)).toBe('17');
    expect(orderRoomLabel({ payments: [], table: 'floor_table:1', customer: { room: '30' } } as never)).toBe('30');
    expect(orderRoomLabel({ payments: [] } as never)).toBe('');
  });
});

describe('listRoomChargedOrders', () => {
  it('keeps only orders with a Room tender line', async () => {
    const db = {
      query: vi.fn().mockResolvedValue([[
        { id: 'order:1', payments: [{ amount: 10, payment_type: { type: 'Room' } }] },
        { id: 'order:2', payments: [{ amount: 10, payment_type: { type: 'Cash' } }] },
      ]]),
    };
    const rows = await listRoomChargedOrders(db, { from: new Date('2026-10-01'), to: new Date('2026-10-08') });
    expect(rows.map((row) => row.id)).toEqual(['order:1']);
  });
});
