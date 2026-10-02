import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import type { Order } from '@/api/model/order.ts';
import { aggregateSalesByOutlet, UNCLASSIFIED_OUTLET_ID } from '@/api/reports/sales/aggregate.ts';

const line = (extra: Record<string, unknown>) => ({
  id: `order_item:${Math.random()}`,
  item: { id: 'menu_item:x', name: 'x', price: 0 },
  quantity: 1,
  price: 0,
  modifiers: [],
  discount: 0,
  service_charges: 0,
  ...extra,
});

const order = (...items: Record<string, unknown>[]) =>
  ({ id: 'order:1', status: 'Paid', items }) as unknown as Order;

describe('aggregateSalesByOutlet', () => {
  it('splits sales by the outlet copied on each line', () => {
    const rows = aggregateSalesByOutlet([
      order(
        line({ price: 4, quantity: 2, outlet_id: new RecordId('outlet', 'bar'), outlet: 'Bar' }),
        line({ price: 12, outlet_id: 'outlet:restaurant', outlet: 'Restaurant' }),
      ),
      order(line({ price: 3, outlet_id: 'outlet:bar', outlet: 'Bar' })),
    ]);

    expect(rows.map((row) => [row.outletName, row.quantity, row.netSales])).toEqual([
      ['Restaurant', 1, 12],
      ['Bar', 3, 11],
    ]);
  });

  it('counts a side with its dish: modifiers are part of the line', () => {
    const [row] = aggregateSalesByOutlet([
      order(line({
        price: 10,
        outlet_id: 'outlet:restaurant',
        outlet: 'Restaurant',
        modifiers: [{ selectedModifiers: [{ price: 2, quantity: 1, dish: { price: 2 } }] }],
      })),
    ]);
    expect(row.netSales).toBe(12);
  });

  it('keeps lines sold before outlets existed apart, last', () => {
    const rows = aggregateSalesByOutlet([
      order(line({ price: 5 }), line({ price: 1, outlet_id: 'outlet:bar', outlet: 'Bar' })),
    ]);
    expect(rows.map((row) => row.outletId)).toEqual(['outlet:bar', UNCLASSIFIED_OUTLET_ID]);
    expect(rows[1].outletName).toBeUndefined();
  });

  it('subtracts line discounts from the total', () => {
    const [row] = aggregateSalesByOutlet([
      order(line({ price: 10, discount: 2, outlet_id: 'outlet:bar', outlet: 'Bar' })),
    ]);
    expect(row.netSales).toBe(10);
    expect(row.discount).toBe(2);
    expect(row.total).toBe(8);
  });
});
