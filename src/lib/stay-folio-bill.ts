import type { Order } from '@/api/model/order.ts';
import { calculateOrderItemPrice } from '@/lib/cart.ts';
import {
  convertPrimaryToPay,
  formatInCurrency,
  getAppCurrency,
} from '@/lib/currency.ts';
import { lineDisplayName } from '@/lib/dish-selling.ts';
import { getInvoiceNumber, getOrderFilteredItems, getOrderSettlementFigures } from '@/lib/order.ts';
import { isRoomPaymentType } from '@/lib/room-charge.ts';
import { safeNumber } from '@/lib/utils.ts';
import enFrontdesk from '@/locales/en/frontdesk.json';
import frFrontdesk from '@/locales/fr/frontdesk.json';

export type StayBillLang = 'en' | 'fr';

type FrontdeskDict = Record<string, string>;

export type StayFolioBillLabels = {
  title: string;
  guest: string;
  room: string;
  dateIn: string;
  dateOut: string;
  order: string;
  qty: string;
  item: string;
  amount: string;
  orderTotal: string;
  roomCharge: string;
  roomTotal: string;
  settledAmount: string;
  outstanding: string;
  settlements: string;
  emptyFolio: string;
  printedAt: string;
  settled: string;
  notSettled: string;
};

export type StayFolioBillInput = {
  guestName: string;
  room: string;
  dateIn: string;
  dateOut: string;
  restaurantName?: string;
  restaurantAddress?: string;
  restaurantContact?: string;
  restaurantLogoDataUrl?: string | null;
  orders: Order[];
  roomTotal: number;
  settledAmount: number;
  outstanding: number;
  settlements: Array<{ amount: number; label?: string; comments?: string; at?: string }>;
  labels: StayFolioBillLabels;
  printedAt?: string;
  /** BCP 47 locale for order timestamps on the sheet (e.g. en-US, fr-HT). */
  locale?: string;
  /** When false, hide stay settlement / due block (single order fiche). Default true. */
  showStaySummary?: boolean;
  /**
   * When false, the totals block shows only the grand total: no collected / due / status
   * lines. For a sales statement, which says nothing about what was collected. Default true.
   */
  showSettlementTotals?: boolean;
  /**
   * Print amounts in this currency (HTG / USD). Amounts on the order are stored in the
   * app primary currency; conversion uses the configured USD↔HTG rate.
   */
  printCurrency?: string;
  /**
   * Per-order charge line (defaults to Room tender). Credit folios pass
   * {@link orderCreditChargeTotal} so the sheet never shows a Room amount of 0.
   */
  chargeAmountOf?: (order: Order) => number;
};

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatWhen = (value: unknown, locale?: string): string => {
  if (value == null || value === '') return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  return locale ? date.toLocaleString(locale) : date.toLocaleString();
};

/** Room tender amount posted on this order against the stay. */
export function orderRoomChargeAmount(order: Order): number {
  return (order.payments ?? [])
    .filter((payment) => payment != null && isRoomPaymentType(payment.payment_type))
    .reduce((sum, payment) => sum + safeNumber(payment?.amount), 0);
}

/** Pure HTML for a single-sheet stay bill (browser print). */
export function buildStayFolioBillHtml(input: StayFolioBillInput): string {
  const L = input.labels;
  const currency = String(input.printCurrency || getAppCurrency()).trim().toUpperCase() || getAppCurrency();
  const money = (amount: number) =>
    escapeHtml(formatInCurrency(convertPrimaryToPay(Number(amount) || 0, currency), currency));

  const chargeOf = input.chargeAmountOf ?? orderRoomChargeAmount;

  const orderBlocks = input.orders.length === 0
    ? `<p class="muted">${escapeHtml(L.emptyFolio)}</p>`
    : input.orders.map((order) => {
      const items = getOrderFilteredItems(order);
      const figures = getOrderSettlementFigures(order);
      const roomCharge = chargeOf(order);
      const when = formatWhen(order.completed_at ?? order.created_at, input.locale);
      const invoice = getInvoiceNumber(order);
      const rows = items.length === 0
        ? `<tr><td colspan="3" class="muted">${escapeHtml(L.emptyFolio)}</td></tr>`
        : items.map((item) => {
          const name = lineDisplayName(item.item?.name, item.variant);
          const qty = safeNumber(item.quantity, 1);
          const lineTotal = calculateOrderItemPrice(item);
          return `<tr>
            <td class="qty">${escapeHtml(qty)}</td>
            <td>${escapeHtml(name)}</td>
            <td class="num">${money(lineTotal)}</td>
          </tr>`;
        }).join('');

      return `<section class="order">
        <header>
          <strong>${escapeHtml(L.order)} ${escapeHtml(invoice)}</strong>
          <span>${escapeHtml(when)}</span>
        </header>
        <table>
          <thead>
            <tr><th class="qty">${escapeHtml(L.qty)}</th><th>${escapeHtml(L.item)}</th><th class="num">${escapeHtml(L.amount)}</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="order-foot">
          <div><span>${escapeHtml(L.orderTotal)}</span><span>${money(figures.grandTotalDue)}</span></div>
          <div><span>${escapeHtml(L.roomCharge)}</span><span>${money(roomCharge)}</span></div>
        </div>
      </section>`;
    }).join('');

  const showStaySummary = input.showStaySummary !== false;
  const settlementRows = !showStaySummary || input.settlements.length === 0
    ? ''
    : `<section class="settlements">
        <h2>${escapeHtml(L.settlements)}</h2>
        <ul>
          ${input.settlements.map((row) => {
            const bits = [
              money(row.amount),
              row.label,
              row.comments,
              row.at,
            ].filter(Boolean).map(escapeHtml);
            return `<li>${bits.join(' · ')}</li>`;
          }).join('')}
        </ul>
      </section>`;

  const statusLabel = input.outstanding <= 0.009 ? L.settled : L.notSettled;
  const settlementTotals = input.showSettlementTotals === false
    ? ''
    : `
      <div><span>${escapeHtml(L.settledAmount)}</span><span>${money(input.settledAmount)}</span></div>
      <div><span>${escapeHtml(L.outstanding)}</span><span>${money(input.outstanding)}</span></div>
      <div class="status">${escapeHtml(statusLabel)}</div>`;
  const totalsBlock = showStaySummary
    ? `<section class="totals">
      <div class="grand"><span>${escapeHtml(L.roomTotal)}</span><span>${money(input.roomTotal)}</span></div>${settlementTotals}
    </section>`
    : '';
  const logo = input.restaurantLogoDataUrl
    ? `<img class="brand-logo" src="${escapeHtml(input.restaurantLogoDataUrl)}" alt="" />`
    : '';
  const brand = [
    logo,
    input.restaurantName && `<div class="brand-name">${escapeHtml(input.restaurantName)}</div>`,
    input.restaurantAddress && `<div class="brand-meta">${escapeHtml(input.restaurantAddress)}</div>`,
    input.restaurantContact && `<div class="brand-meta">${escapeHtml(input.restaurantContact)}</div>`,
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(L.title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Tahoma, sans-serif;
      color: #111;
      margin: 0;
      font-size: 12px;
      line-height: 1.35;
    }
    .sheet { max-width: 720px; margin: 0 auto; }
    h1 { font-size: 20px; margin: 0 0 8px; }
    h2 { font-size: 13px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
    .brand { text-align: center; margin-bottom: 16px; border-bottom: 1px solid #ccc; padding-bottom: 10px; }
    .brand-logo { display: block; margin: 0 auto 8px; max-height: 56px; max-width: 180px; object-fit: contain; }
    .brand-name { font-size: 18px; font-weight: 700; }
    .brand-meta { color: #444; white-space: pre-line; margin-top: 2px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 14px; }
    .meta div { display: flex; justify-content: space-between; gap: 12px; border-bottom: 1px dotted #ddd; padding: 2px 0; }
    .meta span:first-child { color: #555; }
    .order { border: 1px solid #ddd; border-radius: 6px; padding: 10px; margin-bottom: 10px; break-inside: avoid; }
    .order header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 3px 4px; vertical-align: top; }
    th { text-align: left; font-size: 11px; color: #555; border-bottom: 1px solid #ccc; }
    td.num, th.num, .qty { text-align: right; white-space: nowrap; }
    th.qty, td.qty { width: 40px; }
    .order-foot { margin-top: 6px; border-top: 1px solid #eee; padding-top: 4px; }
    .order-foot div, .totals div { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
    .totals { margin-top: 12px; border: 1px solid #222; border-radius: 6px; padding: 10px; }
    .totals .grand { font-size: 15px; font-weight: 700; }
    .settlements { margin-top: 12px; }
    .settlements ul { margin: 0; padding-left: 18px; }
    .muted { color: #666; }
    .status { margin-top: 6px; font-weight: 600; }
    .printed { margin-top: 16px; color: #666; font-size: 11px; text-align: right; }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .order { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${brand ? `<div class="brand">${brand}</div>` : ''}
    <h1>${escapeHtml(L.title)}</h1>
    <div class="meta">
      <div><span>${escapeHtml(L.guest)}</span><strong>${escapeHtml(input.guestName)}</strong></div>
      <div><span>${escapeHtml(L.room)}</span><strong>${escapeHtml(input.room)}</strong></div>
      <div><span>${escapeHtml(L.dateIn)}</span><strong>${escapeHtml(input.dateIn)}</strong></div>
      <div><span>${escapeHtml(L.dateOut)}</span><strong>${escapeHtml(input.dateOut)}</strong></div>
    </div>
    ${orderBlocks}
    ${settlementRows}
    ${totalsBlock}
    ${input.printedAt ? `<div class="printed">${escapeHtml(L.printedAt)}: ${escapeHtml(input.printedAt)}</div>` : ''}
  </div>
</body>
</html>`;
}

/** Bill labels in a fixed language (independent of the UI language). */
export function getStayBillLabels(
  lang: StayBillLang,
  opts?: { singleOrder?: boolean },
): StayFolioBillLabels {
  const dict = (lang === 'en' ? enFrontdesk : frFrontdesk) as FrontdeskDict;
  const t = (key: string) => dict[key] ?? key;
  return {
    title: opts?.singleOrder ? t('billOrderTitle') : t('folioTitle'),
    guest: t('guest'),
    room: t('room'),
    dateIn: t('dateIn'),
    dateOut: t('dateOut'),
    order: t('billOrder'),
    qty: t('billQty'),
    item: t('billItem'),
    amount: t('billAmount'),
    orderTotal: t('billOrderTotal'),
    roomCharge: t('billRoomCharge'),
    roomTotal: t('roomTotal'),
    settledAmount: t('settledAmount'),
    outstanding: t('outstanding'),
    settlements: t('billSettlements'),
    emptyFolio: t('emptyFolio'),
    printedAt: t('billPrintedAt'),
    settled: t('settled'),
    notSettled: t('notSettled'),
  };
}

/**
 * Stay-bill labels for a house-credit folio: same sheet layout, no Room wording.
 * Pass with {@link buildStayFolioBillHtml} and `chargeAmountOf: orderCreditChargeTotal`.
 */
export function getCreditBillLabels(lang: StayBillLang): StayFolioBillLabels {
  const dict = (lang === 'en' ? enFrontdesk : frFrontdesk) as FrontdeskDict;
  const t = (key: string) => dict[key] ?? key;
  const base = getStayBillLabels(lang);
  return {
    ...base,
    title: t('creditBillTitle'),
    room: t('creditBillAccount'),
    dateIn: t('creditBillFrom'),
    dateOut: t('creditBillTo'),
    roomCharge: t('creditBillCharge'),
    roomTotal: t('creditBillTotal'),
    emptyFolio: t('emptyCreditFolio'),
    settled: t('creditSettled'),
    notSettled: t('creditNotSettled'),
  };
}

/**
 * Stay-bill labels for a customer sales statement (Sales by customer report).
 * `filtered`: the per-order line is the share paid with the selected methods.
 * Use with `showSettlementTotals: false`: a sales statement is not a collection receipt.
 */
export function getCustomerSalesBillLabels(
  lang: StayBillLang,
  opts?: { filtered?: boolean },
): StayFolioBillLabels {
  const dict = (lang === 'en' ? enFrontdesk : frFrontdesk) as FrontdeskDict;
  const t = (key: string) => dict[key] ?? key;
  return {
    ...getStayBillLabels(lang),
    title: t('salesBillTitle'),
    room: t('creditBillAccount'),
    dateIn: t('creditBillFrom'),
    dateOut: t('creditBillTo'),
    roomCharge: opts?.filtered ? t('salesBillViaMethods') : t('salesBillOrderTotal'),
    roomTotal: t('salesBillPeriodTotal'),
    emptyFolio: t('salesBillEmpty'),
  };
}

/**
 * Open a printable HTML sheet. Call `open()` synchronously from the click handler
 * (before any await) so the browser does not leave an empty about:blank tab.
 * Do not use noopener: the opener must keep a writable Window reference.
 */
export function openStayBillPrintWindow(): Window | null {
  return window.open('', '_blank', 'width=820,height=960');
}

/** Write a full HTML document into a window opened by {@link openStayBillPrintWindow}, then print. */
export function writeAndPrintStayBillWindow(printWindow: Window, html: string): void {
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  const runPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch (error) {
      console.error('Stay bill window.print failed', error);
    }
  };
  // Give layout / logo data URLs a tick before the print dialog.
  if (printWindow.document.readyState === 'complete') {
    window.setTimeout(runPrint, 150);
  } else {
    printWindow.onload = () => window.setTimeout(runPrint, 150);
  }
}
