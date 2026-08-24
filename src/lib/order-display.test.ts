import { describe, expect, it } from 'vitest';
import { OrderItemKitchenStatus } from '@/api/model/order_item_kitchen.ts';
import type { Order } from '@/api/model/order.ts';
import type { OrderItemKitchen } from '@/api/model/order_item_kitchen.ts';
import {
  buildKitchenRowsMap,
  classifyOrder,
  kitchenOrderItemKey,
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
