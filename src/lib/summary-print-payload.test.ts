import { describe, expect, it } from 'vitest';
import { slimOrdersForSummaryPrint } from './summary-print-payload.ts';

describe('slimOrdersForSummaryPrint', () => {
  it('keeps fields needed for summary totals and drops heavy nested data', () => {
    const slimmed = slimOrdersForSummaryPrint([
      {
        id: { tb: 'order', id: '1' },
        status: 'Completed',
        covers: 2,
        discount_amount: 5,
        discount: { name: 'Happy hour', rate: 10, image: 'huge' },
        service_charge_amount: 1,
        tax_amount: 2,
        tip_amount: 3,
        tax: { name: 'TVA', rate: 10, id: 'tax:1' },
        coupon: { discount: 1, coupon: { code: 'SAVE', image: 'x' } },
        extras: [{ name: 'Bag', value: 2, meta: true }],
        payments: [
          {
            amount: 20,
            payable: 18,
            change: 2,
            payment_type: { type: 'cash', name: 'Cash', title: 'Cash', logo: 'big' },
          },
        ],
        items: [
          {
            id: 'item:1',
            deleted_at: null,
            is_refunded: false,
            quantity: 1,
            price: 10,
            category: 'Drinks',
            item: { name: 'Cola', image: 'data:image/png;base64,AAAA', description: 'long' },
            dish: { name: 'Cola', image: 'data:image/png;base64,BBBB' },
            modifiers: [
              {
                selectedModifiers: [
                  {
                    name: 'Ice',
                    price: 0,
                    dish: { name: 'Ice', image: 'zzz' },
                    selectedGroups: [],
                  },
                ],
              },
            ],
          },
        ],
        user: { first_name: ' ann', last_name: 'Server', photo: 'huge' },
        customer: { name: 'Guest', notes: 'long' },
      },
    ]) as Array<Record<string, unknown>>;

    const order = slimmed[0];
    expect(order.status).toBe('Completed');
    expect(order.covers).toBe(2);
    expect(order.discount).toEqual({ name: 'Happy hour' });
    expect(order.tax).toEqual({ name: 'TVA', rate: 10 });
    expect(order.coupon).toEqual({ discount: 1, coupon: { code: 'SAVE' } });
    expect(order.extras).toEqual([{ name: 'Bag', value: 2 }]);
    expect(order.payments).toEqual([
      {
        amount: 20,
        payable: 18,
        payment_type: { type: 'cash', name: 'Cash', title: 'Cash' },
      },
    ]);
    expect(order.items).toEqual([
      {
        id: 'item:1',
        deleted_at: null,
        is_refunded: false,
        is_suspended: undefined,
        discount: undefined,
        quantity: 1,
        price: 10,
        category: 'Drinks',
        item: { name: 'Cola' },
        dish: { name: 'Cola' },
        modifiers: [
          {
            selectedModifiers: [
              {
                name: 'Ice',
                price: 0,
                dish: { name: 'Ice' },
                selectedGroups: [],
              },
            ],
          },
        ],
      },
    ]);
    expect(order).not.toHaveProperty('user');
    expect(order).not.toHaveProperty('customer');
    const item = (order.items as Array<Record<string, unknown>>)[0];
    expect((item.item as Record<string, unknown>).image).toBeUndefined();
  });

  it('supports { data: Order[] } wrappers', () => {
    const slimmed = slimOrdersForSummaryPrint({
      data: [{ status: 'Completed', items: [], payments: [] }],
    }) as { data: Array<Record<string, unknown>> };
    expect(slimmed.data).toHaveLength(1);
    expect(slimmed.data[0].status).toBe('Completed');
  });
});
