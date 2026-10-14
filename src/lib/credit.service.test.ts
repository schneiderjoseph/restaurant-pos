import { describe, expect, it, vi } from 'vitest';
import {
  CREDIT_SETTLEMENT_TAG,
  CreditServiceError,
  customerCreditOutstanding,
  loadCustomerCreditFolioOrders,
  orderCountsTowardCreditBalance,
  orderCreditChargeTotal,
  orderHasCreditCharge,
  settleCustomerCredit,
} from '@/lib/credit.service.ts';

describe('customerCreditOutstanding', () => {
  it('returns charged minus settled, never negative', () => {
    expect(customerCreditOutstanding(80, 50)).toBe(30);
    expect(customerCreditOutstanding(50, 80)).toBe(0);
    expect(customerCreditOutstanding(0, 0)).toBe(0);
  });
});

describe('orderCountsTowardCreditBalance', () => {
  it('excludes fully refunded Paid orders (Refunded tag, no active lines)', () => {
    expect(orderCountsTowardCreditBalance({
      status: 'Paid',
      tags: ['Refunded'],
      items: [{ id: '1', is_refunded: true }],
      payments: [{ amount: 10, payment_type: { type: 'Credit' } }],
    } as never)).toBe(false);
  });

  it('excludes Refunded tag with empty items (full refund of last lines)', () => {
    expect(orderCountsTowardCreditBalance({
      status: 'Paid',
      tags: ['Refunded'],
      items: [],
      payments: [{ amount: 10, payment_type: { type: 'Credit' } }],
    } as never)).toBe(false);
  });

  it('keeps partial refunds on AR (Refunded tag but active lines remain)', () => {
    expect(orderCountsTowardCreditBalance({
      status: 'Paid',
      tags: ['Refunded'],
      items: [
        { id: '1', is_refunded: true },
        { id: '2', is_refunded: false },
      ],
      payments: [{ amount: 40, payment_type: { type: 'Credit' } }],
    } as never)).toBe(true);
  });

  it('keeps ordinary Paid Credit orders', () => {
    expect(orderCountsTowardCreditBalance({
      status: 'Paid',
      tags: [],
      items: [{ id: '1' }],
      payments: [{ amount: 10, payment_type: { type: 'Credit' } }],
    } as never)).toBe(true);
  });
});

describe('orderHasCreditCharge / orderCreditChargeTotal', () => {
  it('detects Credit tender lines', () => {
    expect(orderHasCreditCharge({
      payments: [{ amount: 10, payment_type: { type: 'Credit' } }],
    } as never)).toBe(true);
    expect(orderHasCreditCharge({
      payments: [{ amount: 10, payment_type: { type: 'Cash' } }],
    } as never)).toBe(false);
  });

  it('caps Credit AR at remaining goods after a partial refund', () => {
    // Original Credit 100; one of two equal lines refunded → remaining ~50.
    expect(orderCreditChargeTotal({
      status: 'Paid',
      tags: ['Refunded'],
      items: [
        { id: '1', quantity: 1, price: 50, is_refunded: true },
        { id: '2', quantity: 1, price: 50, is_refunded: false },
      ],
      payments: [{ amount: 100, payment_type: { type: 'Credit' } }],
      tax_amount: 0,
      tip_amount: 0,
      service_charge_amount: 0,
    } as never)).toBe(50);
  });

  it('does not cap ordinary Paid Credit orders by line totals', () => {
    // Lean row: Credit 80 but no priced items — must not collapse AR to 0.
    expect(orderCreditChargeTotal({
      status: 'Paid',
      tags: [],
      items: [],
      payments: [{ amount: 80, payment_type: { type: 'Credit' } }],
    } as never)).toBe(80);
  });
});

describe('loadCustomerCreditFolioOrders', () => {
  it('keeps only Paid orders with Credit payments for the guest history', async () => {
    const creditOrder = {
      id: 'order:1',
      status: 'Paid',
      items: [{ id: 'i1' }],
      payments: [{ amount: 50, payment_type: { type: 'Credit' } }],
    };
    const cashOrder = {
      id: 'order:2',
      status: 'Paid',
      items: [{ id: 'i2' }],
      payments: [{ amount: 20, payment_type: { type: 'Cash' } }],
    };
    const refundedCredit = {
      id: 'order:3',
      status: 'Paid',
      tags: ['Refunded'],
      items: [{ id: 'i3', is_refunded: true }],
      payments: [{ amount: 40, payment_type: { type: 'Credit' } }],
    };
    const db = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('merged_into')) return [[]];
        if (sql.includes('customer IN $customers')) {
          return [[creditOrder, cashOrder, refundedCredit]];
        }
        return [[]];
      }),
    };
    await expect(loadCustomerCreditFolioOrders(db, 'customer:1')).resolves.toEqual([creditOrder]);
  });
});

/** Credit lines of 50 + 30, and what customer_credit_settlement holds. */
const folioDb = (settled: number[]) => {
  const writes: string[] = [];
  return {
    writes,
    query: vi.fn(async (sql: string, _params?: Record<string, unknown>) => {
      if (sql.includes('BEGIN TRANSACTION')) {
        writes.push(sql);
        return [null];
      }
      if (sql.includes('merged_into')) return [[]];
      if (sql.includes('customer IN $customers') && sql.includes('FROM order')) {
        return [[
          {
            id: 'order:1',
            status: 'Paid',
            items: [{ id: 'a', quantity: 1, price: 50 }],
            payments: [{ amount: 50, payment_type: { type: 'Credit' } }],
            tax_amount: 0,
            tip_amount: 0,
            service_charge_amount: 0,
          },
          {
            id: 'order:2',
            status: 'Paid',
            items: [{ id: 'b', quantity: 1, price: 30 }],
            payments: [{ amount: 30, payment_type: { type: 'Credit' } }],
            tax_amount: 0,
            tip_amount: 0,
            service_charge_amount: 0,
          },
        ]];
      }
      if (sql.includes('SELECT VALUE amount FROM customer_credit_settlement')) {
        return [settled];
      }
      if (sql.includes('counter') || sql.includes('math::max')) {
        return [[{ max_value: 10, value: 11 }]];
      }
      return [[]];
    }),
  };
};

describe('settleCustomerCredit', () => {
  it('refuses Credit or Room as the settle tender', async () => {
    const db = folioDb([50]);
    await expect(
      settleCustomerCredit(db, {
        customerId: 'customer:1',
        paymentTypeId: 'payment_type:credit',
        paymentType: { type: 'Credit' },
        amount: 10,
      }),
    ).rejects.toMatchObject({ code: 'bad_tender' });
    expect(db.writes).toHaveLength(0);
  });

  it('refuses more than what is still due', async () => {
    const db = folioDb([50]);
    await expect(
      settleCustomerCredit(db, {
        customerId: 'customer:1',
        paymentTypeId: 'payment_type:cash',
        paymentType: { type: 'Cash' },
        amount: 40,
      }),
    ).rejects.toBeInstanceOf(CreditServiceError);
  });

  it('refuses when nothing is due', async () => {
    const db = folioDb([80]);
    await expect(
      settleCustomerCredit(db, {
        customerId: 'customer:1',
        paymentTypeId: 'payment_type:cash',
        paymentType: { type: 'Cash' },
      }),
    ).rejects.toMatchObject({ code: 'nothing_to_settle' });
  });

  it('records a Paid credit-settlement order with one cash line', async () => {
    const db = folioDb([50]);
    const result = await settleCustomerCredit(db, {
      customerId: 'customer:1',
      paymentTypeId: 'payment_type:cash',
      paymentType: { type: 'Cash' },
    });
    expect(result.settledAmount).toBe(30);
    expect(result.outstanding).toBe(0);
    const sql = db.writes[0];
    expect(sql).toContain(`tags = ['${CREDIT_SETTLEMENT_TAG}']`);
    expect(sql).toContain("status = 'Paid'");
    expect(sql).toContain('items = []');
    expect(sql).toContain('LET $before = math::sum(');
    const params = db.query.mock.calls.find(([text]) => String(text).includes('BEGIN TRANSACTION'))?.[1] as Record<string, unknown>;
    expect(params.amount).toBe(30);
    expect(params.total).toBe(80);
  });
});
