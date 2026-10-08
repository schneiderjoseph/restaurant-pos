import {Order as OrderModel} from "@/api/model/order.ts";
import {MenuItem} from "@/api/model/cart_item.ts";
import React, {CSSProperties, useMemo} from "react";
import {calculateOrderExtrasTotal, calculateOrderTotal, calculateOrderTotalsPreview, getOrderServiceChargeAmount} from "@/lib/cart.ts";
import {getOrderTaxAmount, getOrderTaxBreakdown} from "@/lib/tax-calculator.ts";
import {previewCartTotals} from "@/lib/cart-tax-preview.ts";
import {cn} from "@/lib/utils.ts";
import {DiscountType} from "@/api/model/discount.ts";
import {getActiveOrderDiscounts, getOrderDisplayItems, getOrderPaymentTotals} from "@/lib/order.ts";
import {useTranslation} from "react-i18next";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Tables} from "@/api/db/tables.ts";
import {formatTaxLabel} from "@/lib/tax-label.ts";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";

const separatorStyle = {'--size': '10px', '--space': '5px'} as CSSProperties;

interface CartTotalsProps {
  cart: MenuItem[]
  itemCount: number
  className?: string
  allowServiceCharges?: boolean
  /** Taxes the order will start without (the customer's exemptions). */
  excludedTaxIds?: string[]
  /** Extras of the order type / table (room service), charged like the taxes. */
  extras?: Array<{name: string, value: number}>
}

export const CartTotals = ({cart, itemCount, className, allowServiceCharges, excludedTaxIds, extras}: CartTotalsProps) => {
  const {t} = useTranslation('orders');
  const preview = useMemo(() => previewCartTotals(cart, excludedTaxIds), [cart, excludedTaxIds]);
  const itemsBase = preview.itemsBase;

  const {data: serviceChargeSettings} = useApi<SettingsData<any>>(
    Tables.settings,
    ["(key = 'service_charges' and is_global = true)"],
    [],
    0,
    1,
    ["values"],
  );

  const serviceChargePreview = useMemo(() => {
    if (!allowServiceCharges) return {amount: 0, label: ''};
    const values = serviceChargeSettings?.data?.[0]?.values;
    const typeRaw = values?.type?.value ?? values?.type;
    const valueRaw = values?.value?.value ?? values?.value;
    const type = String(typeRaw || DiscountType.Percent);
    const value = Number(valueRaw || 0);
    if (value <= 0) return {amount: 0, label: ''};
    const amount = type === DiscountType.Fixed ? value : (itemsBase * value / 100);
    const label = type === DiscountType.Fixed ? '' : `${value}%`;
    return {amount, label};
  }, [allowServiceCharges, serviceChargeSettings, itemsBase]);

  const extrasTotal = (extras ?? []).reduce((sum, extra) => sum + extra.value, 0);
  const grandTotal = itemsBase + preview.taxTotal + serviceChargePreview.amount + extrasTotal;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex font-bold">
        <div className="flex-1">{t('totals.items', {count: itemCount})}</div>
        <div className="text-right"><DualCurrency amount={itemsBase} /></div>
      </div>
      {preview.taxes.map(({tax, amount: taxAmount}) => (
        <div className="flex" key={tax.id?.toString() ?? `${tax.name}-${tax.rate}`}>
          <div className="flex-1">
            {t('totals.tax')} ({formatTaxLabel(tax.name, tax.rate)})
          </div>
          <div className="text-right"><DualCurrency amount={taxAmount} /></div>
        </div>
      ))}
      {serviceChargePreview.amount > 0 && (
        <div className="flex">
          <div className="flex-1">{t('totals.serviceCharges', {value: serviceChargePreview.label, unit: ''})}</div>
          <div className="text-right"><DualCurrency amount={serviceChargePreview.amount} /></div>
        </div>
      )}
      {(extras ?? []).map((extra) => (
        <div className="flex" key={extra.name} data-testid="cart-totals-extra">
          <div className="flex-1">{extra.name}</div>
          <div className="text-right"><DualCurrency amount={extra.value} /></div>
        </div>
      ))}
      <div className="separator h-[2px]" style={separatorStyle}></div>
      <div className="flex font-bold text-2xl text-success-900">
        <div className="flex-1">{t('totals.total')}</div>
        <div className="text-right"><DualCurrency amount={grandTotal} /></div>
      </div>
    </div>
  );
};

interface Props {
  order: OrderModel
  cart?: MenuItem[]
  className?: string
  compact?: boolean
}

export const OrderTotals = ({order, cart, className, compact}: Props) => {
  const {t} = useTranslation('orders');

  const preview = useMemo(() => {
    if (cart) {
      return calculateOrderTotalsPreview(order, cart);
    }

    const itemsTotal = calculateOrderTotal(order);
    const extrasTotal = calculateOrderExtrasTotal(order);
    const taxAmount = itemsTotal <= 0 ? 0 : getOrderTaxAmount(order);
    const serviceChargeAmount = getOrderServiceChargeAmount(order, itemsTotal);
    const discountAmount = itemsTotal <= 0 ? 0 : Number(order?.discount_amount ?? 0);
    const tipAmount = itemsTotal <= 0 ? 0 : Number(order?.tip_amount ?? 0);
    const couponAmount = itemsTotal <= 0 ? 0 : Number(order?.coupon?.discount ?? 0);
    const total = itemsTotal + extrasTotal + taxAmount - discountAmount - couponAmount + serviceChargeAmount + tipAmount;

    return {
      itemsTotal,
      itemCount: getOrderDisplayItems(order).length,
      taxAmount,
      serviceChargeAmount,
      discountAmount,
      tipAmount,
      total,
    };
  }, [order, cart]);

  const taxBreakdown = useMemo(() => {
    if (cart) {
      return [];
    }
    return getOrderTaxBreakdown(order);
  }, [order, cart]);

  // Tendered minus applied: positive when the guest over-pays in cash.
  const changeDue = useMemo(() => getOrderPaymentTotals({payments: order?.payments}).change, [order?.payments]);

  /** Detail label for a discount line: "10% Summer Sale" or "50 Summer Sale" */
  const formatDiscountDetail = (name: string | undefined | null, valueType?: string | null, rate?: number | null) => {
    const base = name || '';
    const n = Number(rate ?? 0);
    const isPercent = valueType === 'percent' || (!valueType && n > 0);
    if (valueType === 'fixed_amount' && n > 0) {
      return base ? `${n} ${base}` : `${n}`;
    }
    if (isPercent && n > 0) {
      return base ? `${n}% ${base}` : `${n}%`;
    }
    return base;
  };

  /** Single-discount header: "Discount (10% Summer Sale)" — value before name */
  const formatDiscountMinimal = (name: string | undefined | null, valueType?: string | null, rate?: number | null) => {
    const label = t('totals.discount');
    const n = Number(rate ?? 0);
    const isPercent = valueType === 'percent' || (!valueType && n > 0);
    if (name && valueType === 'fixed_amount' && n > 0) {
      return `${label} (${n} ${name})`;
    }
    if (name && isPercent && n > 0) {
      return `${label} (${n}% ${name})`;
    }
    if (name) {
      return `${label} (${name})`;
    }
    if (isPercent && n > 0) {
      return `${label} (${n}%)`;
    }
    return label;
  };

  const activeDiscountLines = getActiveOrderDiscounts(order);
  const showLegacyDiscount = activeDiscountLines.length === 0 && (!!order?.discount || preview.discountAmount > 0);

  const taxLines = preview.taxAmount > 0 && (
    taxBreakdown.length > 0 ? taxBreakdown.map((entry, index) => (
      <div className="flex" key={`${entry.name}-${entry.rate}-${index}`}>
        <div className="flex-1">
          {t('totals.tax')} ({formatTaxLabel(entry.name, entry.rate)})
        </div>
        <div className="text-right"><DualCurrency amount={entry.amount} /></div>
      </div>
    )) : (
      <div className="flex">
        <div className="flex-1">
          {t('totals.tax')}
          {order?.tax && <> ({formatTaxLabel(order.tax.name, order.tax.rate)})</>}
        </div>
        <div className="text-right"><DualCurrency amount={preview.taxAmount} /></div>
      </div>
    )
  );

  if (compact) {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        {taxLines}
        <div className="flex font-bold text-2xl text-success-900">
          <div className="flex-1">{t('totals.total')}</div>
          <div className="text-right"><DualCurrency amount={preview.total} /></div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex font-bold">
        <div className="flex-1">{t('totals.items', {count: preview.itemCount})}</div>
        <div className="text-right"><DualCurrency amount={preview.itemsTotal} /></div>
      </div>
      {taxLines}
      {activeDiscountLines.length === 1 ? (
        <div className="flex">
          <div className="flex-1">
            {formatDiscountMinimal(
              activeDiscountLines[0].name,
              activeDiscountLines[0].value_type,
              activeDiscountLines[0].applied_rate
            )}
          </div>
          <div className="text-right"><DualCurrency amount={Number(activeDiscountLines[0].applied_amount ?? 0)} /></div>
        </div>
      ) : activeDiscountLines.length > 1 ? (
        <>
          <div className="flex">
            <div className="flex-1">{t('totals.discount')}</div>
            <div className="text-right"><DualCurrency amount={preview.discountAmount} /></div>
          </div>
          {activeDiscountLines.map((od, index) => (
            <div className="flex pl-3" key={od.id?.toString?.() ?? `${od.name}-${index}`}>
              <div className="flex-1">{formatDiscountDetail(od.name, od.value_type, od.applied_rate) || t('totals.discount')}</div>
              <div className="text-right"><DualCurrency amount={Number(od.applied_amount ?? 0)} /></div>
            </div>
          ))}
        </>
      ) : showLegacyDiscount ? (
        <div className="flex">
          <div className="flex-1">{formatDiscountMinimal(order?.discount?.name, order?.discount?.value_type, order?.discount_rate)}</div>
          <div className="text-right"><DualCurrency amount={preview.discountAmount} /></div>
        </div>
      ) : null}
      {preview.serviceChargeAmount > 0 ? (
        <div className="flex">
          <div className="flex-1">{t('totals.serviceCharges', {
            value: order?.service_charge,
            unit: order?.service_charge_type === DiscountType.Percent ? '%' : ''
          })}</div>
          <div className="text-right"><DualCurrency amount={preview.serviceChargeAmount} /></div>
        </div>
      ) : null}
      {order?.extras && order?.extras?.filter(item => item !== undefined)
        ?.map((item, index) => (
        <div className="flex" key={index}>
          <div className="flex-1">{item.name}</div>
          <div className="text-right"><DualCurrency amount={item.value} /></div>
        </div>
      ))}
      {preview.tipAmount > 0 && (
        <div className="flex">
          <div
            className="flex-1">{order?.tip_type === DiscountType.Percent ? t('totals.tipPercent') : t('totals.tip')}</div>
          <div className="text-right"><DualCurrency amount={preview.tipAmount} /></div>
        </div>
      )}
      {order?.payments?.length > 0 && (
        <div className="separator h-[2px]" style={separatorStyle}></div>
      )}
      {order?.payments?.filter(item => item != null)
        ?.map((item, index) => (
        <div key={index} className="flex">
          <div className="flex-1">{item.payment_type?.name ?? t('totals.payment')}</div>
          <div className="text-right"><DualCurrency amount={item.amount} /></div>
        </div>
      ))}
      <div className="separator h-[2px]" style={separatorStyle}></div>
      <div className="flex font-bold text-2xl text-success-900">
        <div className="flex-1">{t('totals.total')}</div>
        <div className="text-right"><DualCurrency amount={preview.total} /></div>
      </div>
      {order?.payments?.length > 0 && changeDue !== 0 && (
        <>
          <div className="separator h-[2px]" style={separatorStyle}></div>
          <div className="flex">
            <div className="flex-1">{t('totals.change')}</div>
            <div className="text-right"><DualCurrency amount={changeDue} /></div>
          </div>
        </>
      )}
    </div>
  );
};
