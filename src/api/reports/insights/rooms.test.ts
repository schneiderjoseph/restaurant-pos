import {describe, expect, it} from 'vitest';
import type {Order} from '@/api/model/order.ts';
import {buildRoomChargeRows, type RoomChargeRow} from '@/api/reports/sales/room-charges.ts';
import {buildRoomChargeInsights, groupRoomChargesByGuest} from '@/api/reports/insights/rooms.ts';

const t = (key: string, params?: Record<string, unknown>) => `${key}${params ? ' ' + JSON.stringify(params) : ''}`;
const fmt = (n: number) => n.toFixed(0);

const room = {type: 'Room', name: 'ROOM'};
const cash = {type: 'Cash', name: 'Cash'};

const order = (over: Record<string, unknown>): Order => ({
  id: 'order:x',
  invoice_number: 1,
  created_at: '2026-11-04T12:00:00Z',
  status: 'Paid',
  ...over,
}) as unknown as Order;

describe('room charge rows', () => {
  it('keeps only the room part of a mixed payment and reads the ASI folio', () => {
    const rows = buildRoomChargeRows([
      order({
        id: 'order:a',
        invoice_number: 10,
        customer: {id: 'customer:asi_fd_1', name: 'Ana', room: '18', source: 'asi-fd', in_house: true, asi_folio_no: '32662'},
        payments: [
          {amount: 300, payable: 1000, payment_type: cash},
          {amount: 700, payable: 1000, payment_type: room},
        ],
      }),
      order({id: 'order:b', payments: [{amount: 500, payable: 500, payment_type: cash}]}),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({invoiceNumber: 10, roomAmount: 700, orderTotal: 1000, room: '18', folio: '32662', source: 'asi', inHouse: true});
  });

  it('takes the room of a manual stay and flags it unsettled once closed', () => {
    const rows = buildRoomChargeRows([
      order({
        customer: {id: 'customer:l1', name: 'Bob', source: 'local'},
        payments: [{amount: 400, payable: 400, payment_type: room, stay: {id: 'stay:s1', room: '5', status: 'closed'}}],
      }),
    ]);
    expect(rows[0]).toMatchObject({room: '5', folio: '', source: 'manual', inHouse: false, stayClosed: true, staySettled: false});
    expect(groupRoomChargesByGuest(rows)[0].unsettled).toBe(true);
  });
});

describe('room charge rules', () => {
  const row = (over: Partial<RoomChargeRow>): RoomChargeRow => ({
    orderId: 'o', invoiceNumber: 1, createdAt: new Date('2026-11-04T12:00:00Z'), guestId: 'g1', guestName: 'Ana', room: '18',
    folio: '1', source: 'asi', inHouse: true, stayId: '', stayClosed: false, staySettled: false, roomAmount: 100, orderTotal: 100, cashierName: '',
    ...over,
  });

  it('says so when nothing was charged', () => {
    expect(buildRoomChargeInsights([], 1000, t, fmt).map((i) => i.id)).toEqual(['none']);
  });

  it('flags unsettled stays, missing folios, departed guests and large charges', () => {
    const rows = [
      row({invoiceNumber: 1}), row({invoiceNumber: 2}), row({invoiceNumber: 3}), row({invoiceNumber: 4}),
      row({invoiceNumber: 5, guestId: 'g2', guestName: 'Bob', room: '20', folio: '', inHouse: false, roomAmount: 2000}),
      row({invoiceNumber: 6, guestId: 'g3', guestName: 'Cid', room: '5', folio: '', source: 'manual', stayId: 's1', inHouse: false, stayClosed: true}),
    ];
    const ids = buildRoomChargeInsights(rows, 10000, t, fmt).map((i) => i.id);
    expect(ids).toEqual(['share', 'top-guest', 'unsettled', 'no-folio', 'departed', 'large']);
  });
});
