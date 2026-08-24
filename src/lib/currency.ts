/** ISO currency codes supported by the POS (display + quick tender chips). */
export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  HTG: 'G',
  PKR: 'Rs',
  EUR: '€',
  GBP: '£',
};

export const APP_CURRENCIES = ['HTG', 'USD'] as const;
export type AppCurrencyCode = (typeof APP_CURRENCIES)[number];

/** Quick tender chip amounts per currency (whole units; see VITE_DECIMAL_PLACES). */
export const CURRENCY_DENOMINATIONS: Record<string, number[]> = {
  USD: [1, 5, 10, 20, 50, 100],
  HTG: [10, 25, 50, 100, 250, 500, 1000],
  PKR: [1, 2, 5, 10, 20, 50, 100, 500, 1000, 5000],
};

/** Locales that format cleanly with Intl for each currency. */
export const CURRENCY_LOCALES: Record<string, string> = {
  HTG: 'fr-HT',
  USD: 'en-US',
  PKR: 'en-PK',
  EUR: 'fr-FR',
  GBP: 'en-GB',
};

let appCurrencyCode: string | null = null;
let usdToHtgRate: number | null = null;
const currencyListeners = new Set<() => void>();

function notifyCurrencyListeners() {
  currencyListeners.forEach((listener) => listener());
}

export function subscribeCurrencyDisplay(listener: () => void): () => void {
  currencyListeners.add(listener);
  return () => {
    currencyListeners.delete(listener);
  };
}

export function getCurrencyDisplaySnapshot(): string {
  return `${getAppCurrency()}|${getUsdToHtgRate() ?? ''}`;
}

export function setAppCurrencyCode(code: string | null | undefined): void {
  const next = (code || '').trim().toUpperCase();
  appCurrencyCode = next || null;
  notifyCurrencyListeners();
}

export function setUsdToHtgRate(rate: number | null | undefined): void {
  const n = Number(rate);
  usdToHtgRate = Number.isFinite(n) && n > 0 ? n : null;
  notifyCurrencyListeners();
}

export function getUsdToHtgRate(): number | null {
  return usdToHtgRate;
}

export function shouldShowSecondaryCurrency(): boolean {
  const primary = getAppCurrency();
  const rate = getUsdToHtgRate();
  if (!rate || rate <= 0) return false;
  return primary === 'USD' || primary === 'HTG';
}

/** Format amount in the secondary currency line (USD↔HTG using configured rate). */
export function formatSecondaryCurrency(amount: string | number | undefined): string | null {
  const rate = getUsdToHtgRate();
  if (!rate || amount === undefined) return null;

  const n = Number(amount);
  if (!Number.isFinite(n)) return null;

  const primary = getAppCurrency();
  if (primary === 'USD') {
    return formatCurrencyAmount(n * rate, 'HTG');
  }
  if (primary === 'HTG') {
    return formatCurrencyAmount(n / rate, 'USD');
  }
  return null;
}

function formatCurrencyAmount(amount: number, code: AppCurrencyCode): string {
  const locale = CURRENCY_LOCALES[code] || 'en-US';
  const showSymbol = true;
  if (!showSymbol) {
    return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount);
  }
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    maximumFractionDigits: code === 'USD' ? 2 : 0,
  }).format(amount);
}

export function getAppCurrency(): string {
  if (appCurrencyCode) return appCurrencyCode;
  const fromEnv = (import.meta.env.VITE_CURRENCY as string | undefined)?.trim();
  return (fromEnv || 'HTG').toUpperCase();
}

export function getAppLocale(): string {
  const currency = getAppCurrency();
  const mapped = CURRENCY_LOCALES[currency];
  if (mapped) return mapped;
  const fromEnv = (import.meta.env.VITE_LOCALE as string | undefined)?.trim();
  return fromEnv || 'en-US';
}

export function getCurrencySymbol(code?: string): string {
  const currency = (code || getAppCurrency()).toUpperCase();
  return CURRENCY_SYMBOLS[currency] || currency;
}

export function getQuickDenominations(code?: string): number[] {
  const currency = (code || getAppCurrency()).toUpperCase();
  return CURRENCY_DENOMINATIONS[currency] || CURRENCY_DENOMINATIONS.USD;
}

export function getSecondaryCurrency(): string | undefined {
  const raw = (import.meta.env.VITE_SECONDARY_CURRENCY as string | undefined)?.trim();
  if (!raw) return undefined;
  const secondary = raw.toUpperCase();
  if (secondary === getAppCurrency()) return undefined;
  return secondary;
}

export type PayCurrencyCode = AppCurrencyCode;

/** Currencies the cashier can tender in (needs a configured USD↔HTG rate). */
export function getPayableCurrencies(): PayCurrencyCode[] {
  if (!shouldShowSecondaryCurrency()) {
    return [getAppCurrency() as PayCurrencyCode];
  }
  return ['USD', 'HTG'];
}

function roundMoney(amount: number, code: string): number {
  const decimals = code === 'HTG' ? 0 : 2;
  const factor = 10 ** decimals;
  return Math.round(amount * factor) / factor;
}

/** Convert an amount stored in the app primary currency into the pay (tender) currency. */
export function convertPrimaryToPay(amountPrimary: number, payCurrency: string): number {
  const primary = getAppCurrency();
  const pay = (payCurrency || primary).toUpperCase();
  if (pay === primary) return roundMoney(amountPrimary, pay);

  const rate = getUsdToHtgRate();
  if (!rate) return roundMoney(amountPrimary, pay);

  if (primary === 'USD' && pay === 'HTG') return roundMoney(amountPrimary * rate, 'HTG');
  if (primary === 'HTG' && pay === 'USD') return roundMoney(amountPrimary / rate, 'USD');
  return roundMoney(amountPrimary, pay);
}

/** Convert a tendered amount in pay currency back to the app primary currency for storage. */
export function convertPayToPrimary(amountPay: number, payCurrency: string): number {
  const primary = getAppCurrency();
  const pay = (payCurrency || primary).toUpperCase();
  if (pay === primary) return roundMoney(amountPay, primary);

  const rate = getUsdToHtgRate();
  if (!rate) return roundMoney(amountPay, primary);

  if (primary === 'USD' && pay === 'HTG') return roundMoney(amountPay / rate, 'USD');
  if (primary === 'HTG' && pay === 'USD') return roundMoney(amountPay * rate, 'HTG');
  return roundMoney(amountPay, primary);
}

/** Format an amount that is already expressed in `code` (not necessarily app primary). */
export function formatInCurrency(amount: number, code: string): string {
  const currency = (code || getAppCurrency()).toUpperCase();
  const locale = CURRENCY_LOCALES[currency] || getAppLocale();
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(amount);
}
