import { describe, expect, it, vi } from 'vitest';
import { OrderStatus } from '@/api/model/order.ts';
import type { Order } from '@/api/model/order.ts';
import {
  aggregateCustomerCreditAr,
  countedCreditCustomer,
} from '@/api/reports/sales/customer-credit.ts';
import type { DbClient } from '@/api/reports/shared/types.ts';

describe('countedCreditCustomer', () => {
  it('follows merged_into to the keep customer', () => {
    const keep = { id: 'customer:keep', name: 'Keep' };
    expect(countedCreditCustomer({ id: 'customer:drop', name: 'Drop', merged_into: keep })).toEqual(keep);
    expect(countedCreditCustomer(keep)).toEqual(keep);
  });
});

describe('aggregateCustomerCreditAr', () => {
  it('includes revoked credit accounts that still owe and merges duplicates', async () => {
    const creditOrder = {
      id: 'order:1',
      status: OrderStatus.Paid,
      customer: {
        id: 'customer:drop',
        name: 'Old',
        merged_into: { id: 'customer:keep', name: 'House Guest' },
      },
      payments: [{ amount: 100, payment_type: { type: 'Credit', name: 'Credit' } }],
      items: [{ quantity: 1, price: 100, item: { name: 'Meal' } }],
      tags: [],
    } as unknown as Order;

    const revokedStillOwes = {
      id: 'order:2',
      status: OrderStatus.Paid,
      customer: { id: 'customer:revoked', name: 'Revoked Debtor' },
      payments: [{ amount: 40, payment_type: { type: 'Credit', name: 'Credit' } }],
      items: [{ quantity: 1, price: 40, item: { name: 'Drink' } }],
      tags: [],
    } as unknown as Order;

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('customer_credit_settlement')) {
        return [[
          { amount: 25, customer: { id: 'customer:keep', name: 'House Guest' } },
          { amount: 0, customer: { id: 'customer:revoked', name: 'Revoked Debtor' } },
        ]];
      }
      return [[creditOrder, revokedStillOwes]];
    });

    const rows = await aggregateCustomerCreditAr({ query } as unknown as DbClient, { includeSettled: true });
    expect(rows).toHaveLength(2);

    const keep = rows.find((row) => row.customerId === 'customer:keep');
    expect(keep).toMatchObject({ name: 'House Guest', charged: 100, settled: 25, due: 75 });

    const revoked = rows.find((row) => row.customerId === 'customer:revoked');
    expect(revoked).toMatchObject({ name: 'Revoked Debtor', charged: 40, settled: 0, due: 40 });
  });

  it('hides zero-due rows unless includeSettled is set', async () => {
    const paidOff = {
      id: 'order:3',
      status: OrderStatus.Paid,
      customer: { id: 'customer:done', name: 'Settled' },
      payments: [{ amount: 10, payment_type: { type: 'Credit', name: 'Credit' } }],
      items: [{ quantity: 1, price: 10 }],
      tags: [],
    } as unknown as Order;

    const query = vi.fn(async (sql: string) => {
      if (sql.includes('customer_credit_settlement')) {
        return [[{ amount: 10, customer: { id: 'customer:done', name: 'Settled' } }]];
      }
      return [[paidOff]];
    });

    const openOnly = await aggregateCustomerCreditAr({ query } as unknown as DbClient);
    expect(openOnly).toHaveLength(0);

    const withSettled = await aggregateCustomerCreditAr({ query } as unknown as DbClient, { includeSettled: true });
    expect(withSettled).toHaveLength(1);
    expect(withSettled[0].due).toBe(0);
  });
});
