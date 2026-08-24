import type { AppCurrencyCode } from '@/lib/currency.ts';

export const CURRENCY_SYMBOL_KEY = 'currency_symbol';

export interface CurrencySymbolSettings {
  /** ISO currency used for amounts (HTG or USD). */
  code?: AppCurrencyCode;
  /** USD → HTG rate when selling in USD (e.g. 132). Shown as second line when set. */
  usdToHtgRate?: number;
  /** Show currency symbol next to amounts in the app UI. */
  ui: boolean;
  /** Show currency symbol on printed receipts / summaries. */
  receipts: boolean;
}

export const DEFAULT_CURRENCY_SYMBOL: CurrencySymbolSettings = {
  code: 'USD',
  usdToHtgRate: 132,
  ui: true,
  receipts: true,
};
