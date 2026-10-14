import type { Closing, PaymentSummary, TerminalCash } from '@/api/model/closing.ts';
import type { Order } from '@/api/model/order.ts';
import { getOrderPaymentTotals } from '@/lib/order.ts';
import { safeNumber } from '@/lib/utils.ts';

export type ThermalCell = {
  text: string;
  align?: string;
  width?: number;
  style?: string;
};

export type ThermalRow = ThermalCell[];

export type ClosingPrintLabels = {
  terminalCash: string;
  amount: string;
  totalCash: string;
  paymentSummary: string;
  otherPayments: string;
  expenses: string;
  netAmount: string;
};

export type ClosingPrintData = {
  title: string;
  windowLabel?: string;
  terminalCash: Array<{ name: string; amount: number }>;
  payments: Array<{ name: string; amount: number }>;
  totalCash: number;
  totalOtherPayments: number;
  totalExpenses: number;
  netAmount: number;
};

/** ESC/POS table rows for cash closing / règlement de caisse (thermal). */
export function buildClosingThermalRows(
  data: ClosingPrintData,
  labels: ClosingPrintLabels,
  formatAmount: (n: number) => string,
): ThermalRow[] {
  const rows: ThermalRow[] = [
    [{ text: data.title, align: 'CENTER', width: 1, style: 'B' }],
  ];
  if (data.windowLabel) {
    rows.push([{ text: data.windowLabel, align: 'LEFT', width: 1 }]);
  }
  rows.push(
    [{ text: ' ', align: 'LEFT', width: 1 }],
    [
      { text: labels.terminalCash, align: 'LEFT', width: 0.6, style: 'B' },
      { text: labels.amount, align: 'RIGHT', width: 0.4, style: 'B' },
    ],
    ...data.terminalCash.map((terminal) => [
      { text: terminal.name, align: 'LEFT', width: 0.6 },
      { text: formatAmount(terminal.amount), align: 'RIGHT', width: 0.4 },
    ]),
    [
      { text: labels.totalCash, align: 'LEFT', width: 0.6, style: 'B' },
      { text: formatAmount(data.totalCash), align: 'RIGHT', width: 0.4, style: 'B' },
    ],
    [{ text: ' ', align: 'LEFT', width: 1 }],
    [
      { text: labels.paymentSummary, align: 'LEFT', width: 0.6, style: 'B' },
      { text: labels.amount, align: 'RIGHT', width: 0.4, style: 'B' },
    ],
    ...data.payments.map((payment) => [
      { text: payment.name, align: 'LEFT', width: 0.6 },
      { text: formatAmount(payment.amount), align: 'RIGHT', width: 0.4 },
    ]),
    [
      { text: labels.otherPayments, align: 'LEFT', width: 0.6, style: 'B' },
      { text: formatAmount(data.totalOtherPayments), align: 'RIGHT', width: 0.4, style: 'B' },
    ],
    [
      { text: labels.expenses, align: 'LEFT', width: 0.6, style: 'B' },
      { text: formatAmount(data.totalExpenses), align: 'RIGHT', width: 0.4, style: 'B' },
    ],
    [
      { text: labels.netAmount, align: 'LEFT', width: 0.6, style: 'B' },
      { text: formatAmount(data.netAmount), align: 'RIGHT', width: 0.4, style: 'B' },
    ],
  );
  return rows;
}

function paymentTypeName(payment: PaymentSummary): string {
  return payment?.payment_type?.name || 'Payment';
}

function isCashPaymentSummary(payment: PaymentSummary): boolean {
  const type = String(payment?.payment_type?.type || '').toLowerCase().trim();
  const name = String(payment?.payment_type?.name || '').toLowerCase().trim();
  return type === 'cash' || name === 'cash';
}

function isDeferredPaymentSummary(payment: PaymentSummary): boolean {
  const type = String(payment?.payment_type?.type || '').toLowerCase().trim();
  return type === 'room' || type === 'credit';
}

/** Map a saved closing record to thermal print data. */
export function closingToPrintData(
  closing: Closing,
  title: string,
  windowLabel?: string,
): ClosingPrintData {
  const terminalCash = (closing.terminal_cash || []).map((terminal: TerminalCash) => ({
    name: terminal.terminal_name || 'Terminal',
    amount: safeNumber(terminal.cash_amount),
  }));
  const totalCash = terminalCash.reduce((sum, row) => sum + row.amount, 0)
    || safeNumber(closing.total_cash);
  const payments = (closing.payments_data || []).map((payment) => ({
    name: paymentTypeName(payment),
    amount: safeNumber(payment.amount),
  }));
  const totalOtherPayments = (closing.payments_data || [])
    .filter((payment) => !isCashPaymentSummary(payment) && !isDeferredPaymentSummary(payment))
    .reduce((sum, payment) => sum + safeNumber(payment.amount), 0)
    || safeNumber(closing.total_other_payments);
  const totalExpenses = safeNumber(closing.expenses);
  const netAmount = safeNumber(
    closing.net_amount != null
      ? closing.net_amount
      : totalCash + totalOtherPayments - totalExpenses,
  );

  return {
    title,
    windowLabel,
    terminalCash,
    payments,
    totalCash,
    totalOtherPayments,
    totalExpenses,
    netAmount,
  };
}

/**
 * Live règlement from paid orders of the day (when no closing record yet).
 * Thermal slip: payment types + cash / other collected (room/credit listed but not in "other").
 */
export function ordersToCashSettlementPrintData(
  orders: Order[],
  title: string,
  windowLabel?: string,
): ClosingPrintData {
  const paymentMap = new Map<string, number>();
  let cashAmount = 0;
  let otherAmount = 0;

  for (const order of orders || []) {
    const totals = getOrderPaymentTotals(order);
    cashAmount += safeNumber(totals.cashAmount);
    otherAmount += safeNumber(totals.nonCashAmount);

    if (safeNumber(totals.cashAmount) > 0) {
      paymentMap.set('Cash', (paymentMap.get('Cash') || 0) + safeNumber(totals.cashAmount));
    }
    Object.entries(totals.nonCashBreakdown).forEach(([name, amount]) => {
      paymentMap.set(name, (paymentMap.get(name) || 0) + safeNumber(amount));
    });
    Object.entries(totals.deferredBreakdown).forEach(([name, amount]) => {
      paymentMap.set(name, (paymentMap.get(name) || 0) + safeNumber(amount));
    });
  }

  const payments = Array.from(paymentMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    title,
    windowLabel,
    terminalCash: [{ name: 'Cash', amount: cashAmount }],
    payments,
    totalCash: cashAmount,
    totalOtherPayments: otherAmount,
    totalExpenses: 0,
    netAmount: cashAmount + otherAmount,
  };
}
