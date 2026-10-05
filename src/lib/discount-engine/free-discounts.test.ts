import { describe, expect, it } from 'vitest';
import type { Discount } from '@/api/model/discount.ts';
import { computeDiscountAmount } from '@/lib/discount-engine/calculator.ts';

/** The two open discounts seeded by migrations/2026_10_05_free_discounts.surql. */
const FREE_PERCENT = {
  id: 'discount:free_percent', name: 'Remise libre %', type: 'Percent', value_type: 'percent',
  min_value: 0, max_value: 100, scope: 'cart', application_mode: 'manual', priority: 1,
} as unknown as Discount;
const FREE_AMOUNT = {
  id: 'discount:free_amount', name: 'Remise libre (montant)', type: 'Fixed', value_type: 'fixed_amount',
  min_value: 0, max_value: 100000000, scope: 'cart', application_mode: 'manual', priority: 2,
} as unknown as Discount;

describe('open discounts', () => {
  it('takes the typed rate, never above 100 %', () => {
    expect(computeDiscountAmount({ discount: FREE_PERCENT, baseAmount: 1000, rate: 15 }).appliedAmount).toBe(150);
    expect(computeDiscountAmount({ discount: FREE_PERCENT, baseAmount: 1000, rate: 250 }).appliedAmount).toBe(1000);
  });

  it('takes the typed amount, never above the items total', () => {
    expect(computeDiscountAmount({ discount: FREE_AMOUNT, baseAmount: 1000, amount: 300 }).appliedAmount).toBe(300);
    expect(computeDiscountAmount({ discount: FREE_AMOUNT, baseAmount: 1000, amount: 5000 }).appliedAmount).toBe(1000);
  });
});
