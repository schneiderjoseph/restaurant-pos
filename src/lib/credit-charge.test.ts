import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import {
  checkCreditCharge,
  isCreditPaymentType,
  loadCustomerForCreditCharge,
} from '@/lib/credit-charge.ts';

describe('checkCreditCharge', () => {
  it('allows an authorized customer under the limit', () => {
    expect(
      checkCreditCharge({ credit_allowed: true, credit_limit: 100 }, 40, 20),
    ).toEqual({ ok: true, headroom: 40 });
  });

  it('allows unlimited credit when limit is null', () => {
    expect(checkCreditCharge({ credit_allowed: true, credit_limit: null }, 999, 0)).toEqual({
      ok: true,
    });
  });

  it('refuses without a customer', () => {
    expect(checkCreditCharge(undefined, 10)).toEqual({ ok: false, reason: 'no-customer' });
  });

  it('refuses when credit is not allowed', () => {
    expect(checkCreditCharge({ credit_allowed: false }, 10)).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
    expect(checkCreditCharge({ credit_allowed: null }, 10)).toEqual({
      ok: false,
      reason: 'not-allowed',
    });
  });

  it('refuses a soft-deleted customer', () => {
    expect(
      checkCreditCharge({ credit_allowed: true, deleted_at: '2026-10-01T00:00:00Z' }, 10),
    ).toEqual({ ok: false, reason: 'deleted' });
  });

  it('refuses when the charge would exceed the limit', () => {
    expect(
      checkCreditCharge({ credit_allowed: true, credit_limit: 50 }, 20, 40),
    ).toEqual({ ok: false, reason: 'over-limit' });
  });

  it('allows charging exactly up to the limit', () => {
    expect(
      checkCreditCharge({ credit_allowed: true, credit_limit: 50 }, 10, 40),
    ).toEqual({ ok: true, headroom: 0 });
  });
});

describe('isCreditPaymentType', () => {
  it('matches the Credit tender only', () => {
    expect(isCreditPaymentType({ type: 'Credit' })).toBe(true);
    expect(isCreditPaymentType({ type: 'credit' })).toBe(true);
    expect(isCreditPaymentType({ type: 'Cash' })).toBe(false);
    expect(isCreditPaymentType(undefined)).toBe(false);
  });
});

describe('loadCustomerForCreditCharge', () => {
  const dbReturning = (calls: unknown[]) => ({
    query: async (_sql: string, params?: Record<string, unknown>) => {
      calls.push(params?.id);
      return [[{ id: 'customer:1', credit_allowed: true }]];
    },
  });

  it('reads the customer from the database', async () => {
    const calls: unknown[] = [];
    const customer = await loadCustomerForCreditCharge(dbReturning(calls), {
      id: new RecordId('customer', 'house_1'),
      credit_allowed: false,
    });
    expect(customer?.credit_allowed).toBe(true);
    expect(String(calls[0])).toBe('customer:house_1');
  });

  it('returns nothing without a customer', async () => {
    const calls: unknown[] = [];
    expect(await loadCustomerForCreditCharge(dbReturning(calls), undefined)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});
