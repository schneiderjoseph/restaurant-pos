import { describe, expect, it } from 'vitest';
import { withCurrency, withDualCurrency } from '@/lib/utils.ts';
import { setAppCurrencyCode, setUsdToHtgRate } from '@/lib/currency.ts';

describe('withDualCurrency', () => {
  it('matches withCurrency when no rate is set', () => {
    setAppCurrencyCode('USD');
    setUsdToHtgRate(null);
    expect(withDualCurrency(10)).toBe(withCurrency(10));
    setAppCurrencyCode(null);
  });

  it('appends HTG when selling in USD', () => {
    setAppCurrencyCode('USD');
    setUsdToHtgRate(135);
    const formatted = withDualCurrency(10);
    expect(formatted).toContain(withCurrency(10));
    expect(formatted).toMatch(/135|G/);
    setUsdToHtgRate(null);
    setAppCurrencyCode(null);
  });
});
