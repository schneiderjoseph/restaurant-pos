import { describe, expect, it } from 'vitest';
import type { Order } from '@/api/model/order.ts';
import { aggregateSalesByCustomer, ANONYMOUS_CUSTOMER_ROW } from '@/api/reports/sales/customers.ts';

const cashPayment = (amount: number) => ({
  amount,
  payment_type: { name: 'Cash', type: 'cash' },
});

const order = (price: number, customer?: Record<string, unknown>) =>
  ({
    id: `order:${Math.random()}`,
    status: 'Paid',
    customer,
    items: [{ id: `order_item:${Math.random()}`, item: { name: 'x' }, quantity: 1, price, modifiers: [] }],
    payments: [cashPayment(price)],
  }) as unknown as Order;

const CASH = { id: 'customer:cash', name: 'Cash', tags: ['walk-in', 'anonymous', 'cash'] };
const MARIE = { id: 'customer:marie', name: 'Marie Joseph', tags: ['walk-in'] };

describe('aggregateSalesByCustomer', () => {
  it('adds orders without customer and the CASH customer on one anonymous row, first', () => {
    const rows = aggregateSalesByCustomer([order(50, MARIE), order(10), order(20, CASH)]);

    expect(rows.map((row) => [row.customerId, row.orders, row.netSales, row.cash])).toEqual([
      [ANONYMOUS_CUSTOMER_ROW, 2, 30, 30],
      ['customer:marie', 1, 50, 50],
    ]);
  });

  it('counts a merged duplicate for the customer it was folded into', () => {
    const duplicate = { id: 'customer:cash2', name: 'Cash', tags: ['walk-in'], merged_into: CASH };
    const [row] = aggregateSalesByCustomer([order(15, duplicate)]);

    expect(row.customerId).toBe(ANONYMOUS_CUSTOMER_ROW);
  });

  it('sorts customers by total', () => {
    const paul = { id: 'customer:paul', name: 'Paul Pierre' };
    const rows = aggregateSalesByCustomer([order(5, MARIE), order(40, paul)]);

    expect(rows.map((row) => row.name)).toEqual(['Paul Pierre', 'Marie Joseph']);
  });
});
