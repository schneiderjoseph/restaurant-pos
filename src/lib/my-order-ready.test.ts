import { describe, expect, it } from 'vitest';
import { OrderItemKitchenStatus } from '@/api/model/order_item_kitchen.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItemKitchen } from '@/api/model/order_item_kitchen.ts';
import { buildKitchenRowsMap } from '@/lib/order-display.ts';
import { userModulesGrant } from '@/lib/access.rules.ts';
import {
  findNewlyReadyOrders,
  findNewlyReadyStations,
  OrderReadyState,
  readyAnnouncement,
  toReadyAlert,
} from '@/lib/my-order-ready.ts';

const item = { id: { toString: () => 'order_item:1' } };

const order = (overrides: Record<string, unknown> = {}): Order =>
  ({
    id: { toString: () => 'order:12' },
    invoice_number: 12,
    items: [item],
    created_at: new Date('2026-10-05T10:00:00.000Z').toISOString(),
    ...overrides,
  }) as unknown as Order;

const kitchen = (status: OrderItemKitchenStatus, completedAt?: string) =>
  buildKitchenRowsMap([
    {
      id: { toString: () => 'oik:1' },
      order_item: item,
      status,
      ...(completedAt ? { completed_at: completedAt } : {}),
    } as unknown as OrderItemKitchen,
  ]);

describe('findNewlyReadyOrders', () => {
  it('announces an order the kitchen finishes while this terminal watches', () => {
    const first = findNewlyReadyOrders(new Map(), [order()], kitchen(OrderItemKitchenStatus.InProgress));
    expect(first.newlyReady).toEqual([]);

    const second = findNewlyReadyOrders(first.columns, [order()], kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:05:00.000Z'));
    expect(second.newlyReady.map(o => o.id.toString())).toEqual(['order:12']);
  });

  it('announces it once', () => {
    const running: OrderReadyState = new Map([['order:12', { column: 'running', readyAtMs: null }]]);
    const ready = findNewlyReadyOrders(
      running,
      [order()],
      kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:05:00.000Z'),
    );
    const again = findNewlyReadyOrders(
      ready.columns,
      [order()],
      kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:05:00.000Z'),
    );

    expect(again.newlyReady).toEqual([]);
  });

  it('stays quiet for an order already ready when first seen, or with no kitchen work', () => {
    expect(findNewlyReadyOrders(new Map(), [order()], kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:05:00.000Z')).newlyReady)
      .toEqual([]);
    expect(
      findNewlyReadyOrders(
        new Map([['order:12', { column: 'ready', readyAtMs: Date.parse('2026-10-05T10:05:00.000Z') }]]) as OrderReadyState,
        [order()],
        {},
      ).newlyReady,
    ).toEqual([]);
  });

  it('announces again after a kitchen recall then finish (even if running was missed)', () => {
    const firstReady = findNewlyReadyOrders(
      new Map([['order:12', { column: 'running', readyAtMs: null }]]) as OrderReadyState,
      [order()],
      kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:05:00.000Z'),
    );
    expect(firstReady.newlyReady).toHaveLength(1);

    // Debounce skipped the pending blip: still "ready" in memory, but completed_at advanced.
    const afterRecallFinish = findNewlyReadyOrders(
      firstReady.columns,
      [order()],
      kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:20:00.000Z'),
    );
    expect(afterRecallFinish.newlyReady.map(o => o.id.toString())).toEqual(['order:12']);
  });

  it('announces again when running was observed after recall', () => {
    const ready: OrderReadyState = new Map([['order:12', {
      column: 'ready',
      readyAtMs: Date.parse('2026-10-05T10:05:00.000Z'),
    }]]);
    const recalled = findNewlyReadyOrders(ready, [order()], kitchen(OrderItemKitchenStatus.Pending));
    expect(recalled.newlyReady).toEqual([]);
    expect(recalled.columns.get('order:12')?.column).toBe('running');

    const finished = findNewlyReadyOrders(
      recalled.columns,
      [order()],
      kitchen(OrderItemKitchenStatus.Completed, '2026-10-05T10:20:00.000Z'),
    );
    expect(finished.newlyReady.map(o => o.id.toString())).toEqual(['order:12']);
  });
});

describe('readyAnnouncement', () => {
  it('says the guest name first', () => {
    const alert = toReadyAlert(order({ customer: { name: 'Jean Dupont' }, table: { name: 'T', number: 4 } }));
    expect(readyAnnouncement(alert)).toEqual({
      key: 'readyAlert.speechGuest',
      values: { number: '12', guest: 'Jean Dupont' },
    });
  });

  it('falls back to the table, and never reads a #code aloud', () => {
    const alert = toReadyAlert(order({ customer: { guest_code: 'R204' }, table: { name: 'T', number: 4 } }));
    expect(alert.guest).toBe('#R204');
    expect(alert.displayNumber).toBe('#012');
    expect(readyAnnouncement(alert)).toEqual({
      key: 'readyAlert.speechTable',
      values: { number: '12', table: '4' },
    });
  });

  it('gives the number alone for a counter order', () => {
    expect(readyAnnouncement(toReadyAlert(order())).key).toBe('readyAlert.speech');
  });
});

describe('order_visibility.all', () => {
  it('is not granted by access to the Orders page', () => {
    expect(userModulesGrant(['orders', 'menu'], 'order_visibility.all')).toBe(false);
    expect(userModulesGrant(['orders', 'order_visibility.all'], 'order_visibility.all')).toBe(true);
  });
});

describe('ready alert on a hotel room', () => {
  it('reads the room number aloud instead of its code', () => {
    const alert = toReadyAlert(order({ table: { name: 'R', number: '20', source: 'asi-room' } }));

    expect(alert.room).toBe('20');
    expect(readyAnnouncement(alert)).toEqual({
      key: 'readyAlert.speechRoom',
      values: { number: alert.orderNumber, room: '20' },
    });
  });
});

describe('findNewlyReadyStations', () => {
  const bar = { id: { toString: () => 'kitchen:bar' }, name: 'Bar' };
  const cuisine = { id: { toString: () => 'kitchen:cuisine' }, name: 'Cuisine' };
  const drink = { id: { toString: () => 'order_item:1' } };
  const dish = { id: { toString: () => 'order_item:2' } };
  const twoStations = order({ items: [drink, dish] });

  const rows = (barStatus: OrderItemKitchenStatus, cuisineStatus: OrderItemKitchenStatus) =>
    buildKitchenRowsMap([
      { id: { toString: () => 'oik:1' }, order_item: drink, kitchen: bar, status: barStatus },
      { id: { toString: () => 'oik:2' }, order_item: dish, kitchen: cuisine, status: cuisineStatus },
    ] as unknown as OrderItemKitchen[]);

  const { InProgress, Completed } = OrderItemKitchenStatus;

  it('announces the bar when it finishes before the kitchen', () => {
    const first = findNewlyReadyStations(new Map(), [twoStations], rows(InProgress, InProgress));
    expect(first.newlyReady).toEqual([]);

    const second = findNewlyReadyStations(first.stations, [twoStations], rows(Completed, InProgress));
    expect(second.newlyReady.map(r => r.station)).toEqual(['Bar']);

    const again = findNewlyReadyStations(second.stations, [twoStations], rows(Completed, InProgress));
    expect(again.newlyReady).toEqual([]);
  });

  it('leaves the last station to the whole-order alert', () => {
    const first = findNewlyReadyStations(new Map(), [twoStations], rows(Completed, InProgress));
    const second = findNewlyReadyStations(first.stations, [twoStations], rows(Completed, Completed));
    expect(second.newlyReady).toEqual([]);
  });

  it('stays quiet for a single-station order', () => {
    const single = order({ items: [drink] });
    const map = (status: OrderItemKitchenStatus) => buildKitchenRowsMap([
      { id: { toString: () => 'oik:1' }, order_item: drink, kitchen: bar, status },
    ] as unknown as OrderItemKitchen[]);
    const first = findNewlyReadyStations(new Map(), [single], map(InProgress));
    expect(findNewlyReadyStations(first.stations, [single], map(Completed)).newlyReady).toEqual([]);
  });

  it('reads the station aloud and keys the alert apart from the whole order', () => {
    const alert = toReadyAlert(twoStations, 'Bar');
    expect(alert.id).toBe('order:12#Bar');
    expect(readyAnnouncement(alert)).toEqual({
      key: 'readyAlert.speechStation',
      values: { number: '12', station: 'Bar' },
    });
  });

  it('names the guest, room or table like the whole-order alert', () => {
    const withGuest = order({ items: [drink, dish], customer: { name: 'Jean Dupont' }, table: { name: 'T', number: 4 } });
    expect(readyAnnouncement(toReadyAlert(withGuest, 'Bar'))).toEqual({
      key: 'readyAlert.speechStationGuest',
      values: { number: '12', station: 'Bar', guest: 'Jean Dupont' },
    });

    const atTable = order({ items: [drink, dish], table: { name: 'T', number: 4 } });
    expect(readyAnnouncement(toReadyAlert(atTable, 'Bar'))).toEqual({
      key: 'readyAlert.speechStationTable',
      values: { number: '12', station: 'Bar', table: '4' },
    });

    const inRoom = order({ items: [drink, dish], table: { name: 'R', number: '20', source: 'asi-room' } });
    expect(readyAnnouncement(toReadyAlert(inRoom, 'Bar'))).toEqual({
      key: 'readyAlert.speechStationRoom',
      values: { number: '12', station: 'Bar', room: '20' },
    });
  });
});
