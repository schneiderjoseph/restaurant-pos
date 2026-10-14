import { afterEach, describe, expect, it } from 'vitest';
import { OrderStatus } from '@/api/model/order.ts';
import type { Order } from '@/api/model/order.ts';
import { setAppCurrencyCode, setUsdToHtgRate } from '@/lib/currency.ts';
import { buildStayFolioBillHtml, getStayBillLabels, orderRoomChargeAmount } from '@/lib/stay-folio-bill.ts';

const labels = {
  title: 'Stay bill',
  guest: 'Guest',
  room: 'Room',
  dateIn: 'Arrival',
  dateOut: 'Departure',
  order: 'Order',
  qty: 'Qty',
  item: 'Item',
  amount: 'Amount',
  orderTotal: 'Order total',
  roomCharge: 'Charged to room',
  roomTotal: 'Room total',
  settledAmount: 'Collected',
  outstanding: 'Due',
  settlements: 'Payments received',
  emptyFolio: 'No Room charges on this stay',
  printedAt: 'Printed',
  settled: 'Folio settled',
  notSettled: 'Folio not settled',
};

const sampleOrder = {
  id: 'order:1',
  invoice_number: 42,
  status: OrderStatus.Paid,
  created_at: '2026-10-09T12:00:00.000Z',
  items: [
    {
      id: 'order_item:1',
      quantity: 2,
      price: 10,
      item: { name: 'Burger' },
    },
  ],
  payments: [
    { id: 'order_payment:1', amount: 20, payment_type: { type: 'Room', name: 'Room' } },
  ],
} as unknown as Order;

describe('getStayBillLabels', () => {
  it('returns English and French label sets', () => {
    const en = getStayBillLabels('en');
    const fr = getStayBillLabels('fr');
    expect(en.title).toBe('Stay bill');
    expect(en.roomCharge).toBe('Charged to room');
    expect(fr.title).toBe('Facture de séjour');
    expect(fr.roomCharge).toBe('Porté en chambre');
    expect(getStayBillLabels('en', { singleOrder: true }).title).toBe('Order bill');
    expect(getStayBillLabels('fr', { singleOrder: true }).title).toBe('Fiche commande');
  });
});

describe('orderRoomChargeAmount', () => {
  it('sums only Room tender lines', () => {
    const order = {
      payments: [
        { amount: 20, payment_type: { type: 'Room' } },
        { amount: 5, payment_type: { type: 'Cash' } },
      ],
    } as unknown as Order;
    expect(orderRoomChargeAmount(order)).toBe(20);
  });
});

describe('buildStayFolioBillHtml', () => {
  it('renders guest, room, itemized orders and stay totals on one sheet', () => {
    const html = buildStayFolioBillHtml({
      guestName: 'Jean Dupont',
      room: '14',
      dateIn: '2026-10-08',
      dateOut: '2026-10-10',
      restaurantName: 'Cormier Resort',
      orders: [sampleOrder],
      roomTotal: 20,
      settledAmount: 20,
      outstanding: 0,
      settlements: [{ amount: 20, label: 'Cash' }],
      labels,
      printedAt: '10/10/2026, 10:00:00 AM',
    });

    expect(html).toContain('Stay bill');
    expect(html).toContain('Cormier Resort');
    expect(html).toContain('Jean Dupont');
    expect(html).toContain('14');
    expect(html).toContain('Burger');
    expect(html).toContain('Order 42');
    expect(html).toContain('Charged to room');
    expect(html).toContain('Payments received');
    expect(html).toContain('Folio settled');
    expect(html).toContain('@page { size: A4;');
  });

  it('can print a single order fiche without the stay settlement summary', () => {
    const html = buildStayFolioBillHtml({
      guestName: 'Jean Dupont',
      room: '14',
      dateIn: '2026-10-08',
      dateOut: '2026-10-10',
      orders: [sampleOrder],
      roomTotal: 20,
      settledAmount: 0,
      outstanding: 20,
      settlements: [],
      labels,
      showStaySummary: false,
    });
    expect(html).toContain('Burger');
    expect(html).not.toContain('class="totals"');
    expect(html).not.toContain('Folio settled');
  });

  it('shows the empty message when the stay has no room orders', () => {
    const html = buildStayFolioBillHtml({
      guestName: 'Walk-in',
      room: '3',
      dateIn: '2026-10-10',
      dateOut: '2026-10-10',
      orders: [],
      roomTotal: 0,
      settledAmount: 0,
      outstanding: 0,
      settlements: [],
      labels,
    });
    expect(html).toContain('No Room charges on this stay');
  });

  it('escapes guest HTML so the print sheet cannot inject markup', () => {
    const html = buildStayFolioBillHtml({
      guestName: '<script>alert(1)</script>',
      room: '1',
      dateIn: '2026-10-10',
      dateOut: '2026-10-10',
      orders: [],
      roomTotal: 0,
      settledAmount: 0,
      outstanding: 0,
      settlements: [],
      labels,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  describe('print currency', () => {
    afterEach(() => {
      setAppCurrencyCode(null);
      setUsdToHtgRate(null);
    });

    it('converts primary HTG amounts into USD when printCurrency is USD', () => {
      setAppCurrencyCode('HTG');
      setUsdToHtgRate(100);
      const html = buildStayFolioBillHtml({
        guestName: 'Jean Dupont',
        room: '14',
        dateIn: '2026-10-08',
        dateOut: '2026-10-10',
        orders: [sampleOrder],
        roomTotal: 2000,
        settledAmount: 0,
        outstanding: 2000,
        settlements: [],
        labels,
        printCurrency: 'USD',
        showStaySummary: true,
      });
      // 2000 HTG / 100 = $20.00
      expect(html).toMatch(/\$20\.00|US\$20\.00/);
    });
  });
});
