import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import { OrderItemKitchenStatus } from '@/api/model/order_item_kitchen.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItemKitchen } from '@/api/model/order_item_kitchen.ts';
import {
  buildKitchenRowsMap,
  classifyOrder,
  kitchenOrderItemKey,
  kitchenReadyOrderIds,
  partitionDisplayOrders,
} from '@/lib/order-display.ts';

const orderWithItems = (items: unknown, invoice = 4): Order =>
  ({
    id: { toString: () => `order:${invoice}` },
    invoice_number: invoice,
    items,
    created_at: new Date().toISOString(),
  }) as unknown as Order;

const kitchenRow = (
  orderItem: unknown,
  status: OrderItemKitchenStatus
): OrderItemKitchen =>
  ({
    id: { toString: () => `oik:${status}` },
    order_item: orderItem as OrderItemKitchen['order_item'],
    status,
  }) as OrderItemKitchen;

describe('kitchenOrderItemKey', () => {
  it('normalizes fetched records and raw record ids', () => {
    const recordId = { tb: 'order_item', id: 'abc', toString: () => 'order_item:abc' };
    expect(kitchenOrderItemKey(recordId)).toBe('order_item:abc');
    expect(kitchenOrderItemKey({ id: recordId, name: 'Burger' })).toBe('order_item:abc');
  });
});

describe('classifyOrder', () => {
  it('accepts a single fetched item object instead of an array', () => {
    const item = { id: { toString: () => 'order_item:1' } };
    const order = orderWithItems(item);
    const map = buildKitchenRowsMap([
      kitchenRow(item, OrderItemKitchenStatus.Completed),
    ]);

    expect(classifyOrder(order, map)).toBe('ready');
  });

  it('ignores FETCH holes in a multi-item list', () => {
    const item = { id: { toString: () => 'order_item:2' } };
    const order = orderWithItems([undefined, item, null]);
    const map = buildKitchenRowsMap([
      kitchenRow(item, OrderItemKitchenStatus.Pending),
    ]);

    expect(classifyOrder(order, map)).toBe('running');
  });

  it('still classifies when kitchen rows keep a raw record id', () => {
    const recordId = { tb: 'order_item', id: 'xyz', toString: () => 'order_item:xyz' };
    const order = orderWithItems([{ id: recordId }]);
    const map = buildKitchenRowsMap([
      kitchenRow(recordId, OrderItemKitchenStatus.Completed),
    ]);

    expect(classifyOrder(order, map)).toBe('ready');
  });

  it('keeps a valid multi-item order even if another order has FETCH holes', () => {
    const goodItem = { id: { toString: () => 'order_item:ok' } };
    const good = orderWithItems([goodItem, { id: { toString: () => 'order_item:ok2' } }], 4);
    const holey = orderWithItems([undefined, { id: { toString: () => 'order_item:hole' } }], 5);

    const { preparing, ready } = partitionDisplayOrders(
      [holey, good],
      buildKitchenRowsMap([
        kitchenRow(goodItem, OrderItemKitchenStatus.Pending),
        kitchenRow({ id: { toString: () => 'order_item:ok2' } }, OrderItemKitchenStatus.Completed),
        kitchenRow({ id: { toString: () => 'order_item:hole' } }, OrderItemKitchenStatus.Completed),
      ])
    );

    expect(preparing.map((order) => order.invoice_number)).toEqual([4]);
    expect(ready.map((order) => order.invoice_number)).toEqual([5]);
  });
});

describe('kitchenReadyOrderIds', () => {
  const orderRef = (orderId: string) => ({ tb: 'order', id: orderId, toString: () => `order:${orderId}` });
  const item = (
    orderId: string,
    extras: { deleted_at?: unknown; is_refunded?: boolean; is_suspended?: boolean } = {}
  ) => ({ order: orderRef(orderId), ...extras });
  const row = (
    orderId: string,
    status: OrderItemKitchenStatus,
    extras: { deleted_at?: unknown; is_suspended?: boolean } = {}
  ) => ({ order: orderRef(orderId), status, ...extras });

  it('keys a real record id as the Orders screen does ("order:a")', () => {
    const order = new RecordId('order', 'a');
    const ready = kitchenReadyOrderIds(
      [{ order }],
      [{ order, status: OrderItemKitchenStatus.Completed }]
    );
    expect(ready.has(order.toString())).toBe(true);
  });

  it('marks an order ready when every kitchen row is completed', () => {
    const ready = kitchenReadyOrderIds(
      [item('a'), item('a')],
      [row('a', OrderItemKitchenStatus.Completed), row('a', OrderItemKitchenStatus.Completed)]
    );
    expect([...ready]).toEqual(['order:a']);
  });

  it('is not ready when any row is pending, in progress, or waiting', () => {
    for (const status of [
      OrderItemKitchenStatus.Pending,
      OrderItemKitchenStatus.InProgress,
      OrderItemKitchenStatus.Waiting,
    ]) {
      const ready = kitchenReadyOrderIds(
        [item('a'), item('a')],
        [row('a', OrderItemKitchenStatus.Completed), row('a', status)]
      );
      expect(ready.has('order:a')).toBe(false);
    }
  });

  it('is ready when nothing was sent to a kitchen, as on the order display', () => {
    expect([...kitchenReadyOrderIds([item('a')], [])]).toEqual(['order:a']);
  });

  it('is not ready without a live item', () => {
    expect(kitchenReadyOrderIds([], []).size).toBe(0);
    const ready = kitchenReadyOrderIds(
      [
        item('a', { deleted_at: '2026-10-01T00:00:00Z' }),
        item('a', { is_refunded: true }),
        item('a', { is_suspended: true }),
      ],
      []
    );
    expect(ready.size).toBe(0);
  });

  it('ignores the kitchen rows of soft-deleted and suspended items', () => {
    const ready = kitchenReadyOrderIds(
      [item('a')],
      [
        row('a', OrderItemKitchenStatus.Completed),
        row('a', OrderItemKitchenStatus.Pending, { deleted_at: '2026-10-01T00:00:00Z' }),
        row('a', OrderItemKitchenStatus.InProgress, { is_suspended: true }),
      ]
    );
    expect([...ready]).toEqual(['order:a']);
  });

  it('handles two orders mixed in one result set', () => {
    const ready = kitchenReadyOrderIds(
      [item('a'), item('b'), item('b')],
      [
        row('a', OrderItemKitchenStatus.Completed),
        row('b', OrderItemKitchenStatus.Pending),
        row('b', OrderItemKitchenStatus.Completed),
      ]
    );
    expect(ready.has('order:a')).toBe(true);
    expect(ready.has('order:b')).toBe(false);
  });
});

describe('partitionDisplayOrders served orders', () => {
  const item = { id: { toString: () => 'order_item:9' } };
  const completedRow = (completedAt: string) => ({
    ...kitchenRow(item, OrderItemKitchenStatus.Completed),
    completed_at: completedAt,
  }) as unknown as OrderItemKitchen;

  it('drops a ready order served after the kitchen finished', () => {
    const order = { ...orderWithItems([item]), served_at: '2026-10-05T12:10:00Z' } as unknown as Order;
    const map = buildKitchenRowsMap([completedRow('2026-10-05T12:00:00Z')]);

    expect(partitionDisplayOrders([order], map).ready).toHaveLength(0);
  });

  it('shows it again once the kitchen finishes something after it was served', () => {
    const order = { ...orderWithItems([item]), served_at: '2026-10-05T12:10:00Z' } as unknown as Order;
    const map = buildKitchenRowsMap([completedRow('2026-10-05T12:30:00Z')]);

    expect(partitionDisplayOrders([order], map).ready).toHaveLength(1);
  });
});
