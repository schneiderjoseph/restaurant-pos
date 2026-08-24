import { describe, expect, it } from 'vitest';
import { OrderItemKitchenStatus } from '@/api/model/order_item_kitchen.ts';
import { getKitchenStationStatuses } from '@/lib/order-display.ts';

describe('getKitchenStationStatuses', () => {
  it('aggregates ready vs pending per kitchen', () => {
    const order = {
      items: [{ id: 'order_item:1' }, { id: 'order_item:2' }],
    } as any;
    const map = {
      'order_item:1': [
        {
          kitchen: { id: 'kitchen:cuisine', name: 'Cuisine' },
          status: OrderItemKitchenStatus.Completed,
        },
      ],
      'order_item:2': [
        {
          kitchen: { id: 'kitchen:bar', name: 'Bar' },
          status: OrderItemKitchenStatus.Pending,
        },
      ],
    } as any;

    const stations = getKitchenStationStatuses(order, map);
    expect(stations).toEqual([
      { kitchenId: 'kitchen:cuisine', kitchenName: 'Cuisine', ready: true },
      { kitchenId: 'kitchen:bar', kitchenName: 'Bar', ready: false },
    ]);
  });

  it('marks a station not ready if any of its rows are still pending', () => {
    const order = {
      items: [{ id: 'order_item:1' }, { id: 'order_item:2' }],
    } as any;
    const map = {
      'order_item:1': [
        {
          kitchen: { id: 'kitchen:bar', name: 'Bar' },
          status: OrderItemKitchenStatus.Completed,
        },
      ],
      'order_item:2': [
        {
          kitchen: { id: 'kitchen:bar', name: 'Bar' },
          status: OrderItemKitchenStatus.Pending,
        },
      ],
    } as any;

    expect(getKitchenStationStatuses(order, map)).toEqual([
      { kitchenId: 'kitchen:bar', kitchenName: 'Bar', ready: false },
    ]);
  });
});
