import { describe, expect, it } from 'vitest';
import {
  buildClosingThermalRows,
  closingToPrintData,
  ordersToCashSettlementPrintData,
} from './closing-print.ts';
import type { Closing } from '@/api/model/closing.ts';
import type { Order } from '@/api/model/order.ts';

const labels = {
  terminalCash: 'Terminal Cash',
  amount: 'Amount',
  totalCash: 'Total Cash',
  paymentSummary: 'Payment Summary',
  otherPayments: 'Other Payments',
  expenses: 'Expenses',
  netAmount: 'Net Amount',
};

describe('closing-print', () => {
  it('builds thermal rows from a closing record', () => {
    const closing = {
      terminal_cash: [{ terminal_id: 't1', terminal_name: 'T1', cash_amount: 100 }],
      payments_data: [
        { payment_type: { name: 'Cash', type: 'cash' }, amount: 100 },
        { payment_type: { name: 'Card', type: 'card' }, amount: 50 },
      ],
      expenses: 10,
      net_amount: 140,
    } as Closing;

    const data = closingToPrintData(closing, 'CLOSING (2026-10-11)');
    const rows = buildClosingThermalRows(data, labels, (n) => String(n));
    const texts = rows.flat().map((cell) => cell.text);
    expect(texts).toContain('CLOSING (2026-10-11)');
    expect(texts).toContain('T1');
    expect(texts).toContain('Card');
    expect(texts).toContain('140');
  });

  it('builds a live settlement from orders when no closing exists', () => {
    const orders = [
      {
        payments: [
          // Each row carries the order payable; amounts sum to that payable (no change).
          { amount: 20, payable: 50, payment_type: { name: 'Cash', type: 'cash' } },
          { amount: 30, payable: 50, payment_type: { name: 'Card', type: 'card' } },
        ],
      },
    ] as Order[];

    const data = ordersToCashSettlementPrintData(orders, 'REGLEMENT');
    expect(data.totalCash).toBe(20);
    expect(data.totalOtherPayments).toBe(30);
    expect(data.payments.some((p) => p.name === 'Card')).toBe(true);
  });
});
