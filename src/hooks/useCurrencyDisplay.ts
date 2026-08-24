import { useSyncExternalStore } from 'react';
import { getCurrencyDisplaySnapshot, subscribeCurrencyDisplay } from '@/lib/currency.ts';

/** Subscribe to currency code + USD→HTG rate so dual-currency UI re-renders after Settings hydrate. */
export function useCurrencyDisplay() {
  return useSyncExternalStore(subscribeCurrencyDisplay, getCurrencyDisplaySnapshot);
}
