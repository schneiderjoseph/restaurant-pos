import { describe, expect, it } from 'vitest';
import { OrderItemKitchenStatus } from '@/api/model/order_item_kitchen.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItemKitchen } from '@/api/model/order_item_kitchen.ts';
import { buildKitchenRowsMap } from '@/lib/order-display.ts';
import { userModulesGrant } from '@/lib/access.rules.ts';
import {
  findNewlyReadyOrders,
  OrderColumns,
  readyAnnouncement,
  toReadyAlert,
} from '@/lib/my-order-ready.ts';

const item = { id: { toString: () => 'order_item:1' } };

const order = (overrides: Record<string, unknown> = {}): Order =>
  ({
    id: { toString: () => 'order:12' },
    invoice_number: 12,
    items: [item],
    created_at: new Date().toISOString(),
    ...overrides,
  }) as unknown as Order;

const kitchen = (status: OrderItemKitchenStatus) =>
  buildKitchenRowsMap([
    { id: { toString: () => 'oik:1' }, order_item: item, status } as unknown as OrderItemKitchen,
  ]);

describe('findNewlyReadyOrders', () => {
  it('announces an order the kitchen finishes while this terminal watches', () => {
    const first = findNewlyReadyOrders(new Map(), [order()], kitchen(OrderItemKitchenStatus.InProgress));
    expect(first.newlyReady).toEqual([]);

    const second = findNewlyReadyOrders(first.columns, [order()], kitchen(OrderItemKitchenStatus.Completed));
    expect(second.newlyReady.map(o => o.id.toString())).toEqual(['order:12']);
  });

  it('announces it once', () => {
    const running: OrderColumns = new Map([['order:12', 'running']]);
    const ready = findNewlyReadyOrders(running, [order()], kitchen(OrderItemKitchenStatus.Completed));
    const again = findNewlyReadyOrders(ready.columns, [order()], kitchen(OrderItemKitchenStatus.Completed));

    expect(again.newlyReady).toEqual([]);
  });

  it('stays quiet for an order already ready when first seen, or with no kitchen work', () => {
    expect(findNewlyReadyOrders(new Map(), [order()], kitchen(OrderItemKitchenStatus.Completed)).newlyReady)
      .toEqual([]);
    expect(findNewlyReadyOrders(new Map([['order:12', 'ready']]), [order()], {}).newlyReady).toEqual([]);
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
      values: { number: '12', table: 'T4' },
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
