import { describe, expect, it } from 'vitest';
import {
  CURRENCY_DENOMINATIONS,
  CURRENCY_SYMBOLS,
  formatSecondaryCurrency,
  getCurrencySymbol,
  getQuickDenominations,
  setAppCurrencyCode,
  getAppCurrency,
  convertPayToPrimary,
  convertPrimaryToPay,
  setUsdToHtgRate,
  shouldShowSecondaryCurrency,
} from '@/lib/currency.ts';

describe('currency', () => {
  it('maps HTG and USD symbols', () => {
    expect(CURRENCY_SYMBOLS.HTG).toBe('G');
    expect(CURRENCY_SYMBOLS.USD).toBe('$');
    expect(getCurrencySymbol('HTG')).toBe('G');
    expect(getCurrencySymbol('USD')).toBe('$');
  });

  it('exposes quick denominations for HTG and USD', () => {
    expect(CURRENCY_DENOMINATIONS.HTG).toContain(100);
    expect(getQuickDenominations('USD')).toEqual([1, 5, 10, 20, 50, 100]);
  });

  it('respects runtime currency override', () => {
    setAppCurrencyCode('USD');
    expect(getAppCurrency()).toBe('USD');
    setAppCurrencyCode('HTG');
    expect(getAppCurrency()).toBe('HTG');
    setAppCurrencyCode(null);
  });

  it('formats secondary HTG line when selling in USD', () => {
    setAppCurrencyCode('USD');
    setUsdToHtgRate(132);
    expect(shouldShowSecondaryCurrency()).toBe(true);
    expect(formatSecondaryCurrency(10)).toMatch(/1[\s\u202f]?320[\s\u202f]?G|G[\s\u202f]?1[\s\u202f]?320/);
    setUsdToHtgRate(null);
    setAppCurrencyCode(null);
  });

  it('formats secondary USD line when selling in HTG', () => {
    setAppCurrencyCode('HTG');
    setUsdToHtgRate(132);
    expect(formatSecondaryCurrency(1320)).toMatch(/\$10/);
    setUsdToHtgRate(null);
    setAppCurrencyCode(null);
  });

  it('converts tender HTG back to primary USD for storage', () => {
    setAppCurrencyCode('USD');
    setUsdToHtgRate(132);
    expect(convertPrimaryToPay(10, 'HTG')).toBe(1320);
    expect(convertPayToPrimary(1320, 'HTG')).toBe(10);
    setUsdToHtgRate(null);
    setAppCurrencyCode(null);
  });
});
