import type { Order } from '@/api/model/order.ts';
import type { Tax } from '@/api/model/tax.ts';
import { DiscountType } from '@/api/model/discount.ts';
import { calculateOrderGrandTotal } from '@/lib/cart.ts';
import { recalculateCart } from '@/lib/discount-engine/recalculate.ts';
import { getDiscountCache } from '@/lib/discount-engine/cache.ts';
import type { AppliedDiscountLine } from '@/lib/discount-engine/types.ts';
import { calculateOrderPaymentTaxAmount, getTaxableShare } from '@/lib/tax-calculator.ts';
import { pickOrderTaxTreatment } from '@/lib/discount-engine/tax.ts';
import { roundCurrency } from '@/lib/discount-engine/rounding.ts';

export interface OrderPaymentTotalsParams {
  tax?: Tax | null;
  discountLines: AppliedDiscountLine[];
  extras: Record<string, number>;
  serviceCharge: number;
  serviceChargeType: DiscountType;
  couponAmount: number;
  tip: number;
  tipType: DiscountType;
  itemsTotal: number;
  /** Last selected payment type — enables payment-gated automatic discounts */
  paymentTypeId?: string;
}

export interface OrderPaymentTotalsResult {
  taxAmount: number;
  discountTotal: number;
  discountLines: AppliedDiscountLine[];
  serviceChargeAmount: number;
  tipAmount: number;
  grandTotal: number;
  total: number;
  /** Share of the line amounts that is taxed (1 unless a discount is taxed after it). */
  taxableShare: number;
}

export const computeOrderPaymentTotals = (
  order: Order,
  params: OrderPaymentTotalsParams,
): OrderPaymentTotalsResult => {
  const {
    tax,
    discountLines,
    extras,
    serviceCharge,
    serviceChargeType,
    couponAmount,
    tip,
    tipType,
    itemsTotal,
    paymentTypeId,
  } = params;

  const extrasTotal = Object.values(extras).reduce((prev, item) => prev + item, 0);
  // Percentages are rounded to the cent like taxes, so the stored amounts add up to the total.
  const serviceChargeAmount = serviceCharge
    ? (serviceChargeType === DiscountType.Percent ? roundCurrency(itemsTotal * serviceCharge / 100) : serviceCharge)
    : 0;
  const tipAmount = tipType === DiscountType.Fixed ? tip : roundCurrency(itemsTotal * tip / 100);
  // `null` = no order-level tax; left out = the order's stored one.
  const resolvedTax = tax === undefined ? order.tax ?? null : tax;

  const base = recalculateCart(order, {
    existingApplications: discountLines.filter(l => l.applicationType === 'manual'),
    manualRequests: [],
    extrasTotal,
    serviceChargeAmount,
    couponAmount,
    tipAmount,
    taxRate: resolvedTax?.rate,
    rules: getDiscountCache().all,
    paymentTypeId,
  });

  // Discounts taxed after them shrink the taxable amount; the same share is stored with
  // the tax rows (syncOrderTaxes) so the bill, order_taxes and reports agree.
  const taxableShare = getTaxableShare(itemsTotal, base.discountTotal, pickOrderTaxTreatment(base.discountLines));
  const resolvedTaxAmount = calculateOrderPaymentTaxAmount(order, resolvedTax, undefined, taxableShare);
  const taxDelta = resolvedTaxAmount - base.taxAmount;
  const grandTotal = base.grandTotal + taxDelta;

  const total = calculateOrderGrandTotal({
    itemsTotal,
    extrasTotal,
    taxAmount: resolvedTaxAmount,
    discountTotal: base.discountTotal,
    serviceChargeAmount,
    couponAmount,
    tipAmount,
  });

  return {
    taxAmount: resolvedTaxAmount,
    discountTotal: base.discountTotal,
    discountLines: base.discountLines,
    serviceChargeAmount,
    tipAmount,
    grandTotal,
    total,
    taxableShare,
  };
};
