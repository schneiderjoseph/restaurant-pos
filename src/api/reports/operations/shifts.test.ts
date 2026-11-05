import {describe, expect, it} from 'vitest';
import type {Order} from '@/api/model/order.ts';
import type {TimeEntry} from '@/api/model/time_entry.ts';
import {buildShiftRows} from '@/api/reports/operations/shifts.ts';

const ana = {id: 'user:ana', first_name: 'Ana', last_name: 'B', user_role: {name: 'Caissier'}};
const bob = {id: 'user:bob', first_name: 'Bob', last_name: 'C'};
const cash = {name: 'Cash', type: 'cash'};
const card = {name: 'Carte', type: 'card'};
const room = {name: 'Chambre', type: 'room'};

const entry = (id: string, user: unknown, inAt: string, outAt?: string) =>
  ({id, user, clock_in: new Date(inAt), clock_out: outAt ? new Date(outAt) : undefined}) as unknown as TimeEntry;

const order = (over: Record<string, unknown>) =>
  ({status: 'Paid', covers: 2, tax_amount: 0, service_charge_amount: 0, tip_amount: 0, ...over}) as unknown as Order;

describe('buildShiftRows', () => {
  const entries = [entry('time_entry:1', ana, '2026-11-05T08:00:00Z', '2026-11-05T16:00:00Z')];
  const orders = [
    order({cashier: ana, created_at: new Date('2026-11-05T09:00:00Z'), payments: [{amount: 100, payment_type: cash}]}),
    order({cashier: ana, created_at: new Date('2026-11-05T10:00:00Z'), payments: [{amount: 50, payment_type: card}], tip_amount: 5}),
    order({cashier: ana, created_at: new Date('2026-11-05T11:00:00Z'), payments: [{amount: 80, payment_type: room}]}),
    // Ana outside her session, Bob never clocked in.
    order({cashier: ana, created_at: new Date('2026-11-05T18:00:00Z'), payments: [{amount: 20, payment_type: cash}]}),
    order({user: bob, created_at: new Date('2026-11-05T12:00:00Z'), payments: [{amount: 30, payment_type: cash}]}),
  ];
  const rows = buildShiftRows(entries, orders, new Date('2026-11-05T20:00:00Z'));

  it('puts orders in the session open when they were created', () => {
    const shift = rows.find((r) => r.key === 'time_entry:1')!;
    expect(shift).toMatchObject({userName: 'Ana B', role: 'Caissier', checks: 3, cash: 100, otherTotal: 50, collected: 150, deferred: 80, tips: 5, durationSeconds: 8 * 3600, active: false});
    expect(shift.otherTenders).toEqual({Carte: 50});
    // 100 + 50 + 80 applied, minus the 5 tip.
    expect(shift.netSales).toBe(225);
  });

  it('keeps orders outside any session on an outside row per person', () => {
    expect(rows.find((r) => r.key === 'outside:user:ana')).toMatchObject({checks: 1, cash: 20, clockIn: null});
    expect(rows.find((r) => r.key === 'outside:user:bob')).toMatchObject({userName: 'Bob C', checks: 1, cash: 30});
  });

  it('accounts for every paid order', () => {
    expect(rows.reduce((s, r) => s + r.checks, 0)).toBe(orders.length);
  });

  it('measures an open session up to now', () => {
    const open = buildShiftRows([entry('time_entry:2', bob, '2026-11-05T18:00:00Z')], [], new Date('2026-11-05T19:30:00Z'));
    expect(open[0]).toMatchObject({active: true, durationSeconds: 5400, clockOut: null});
  });
});
