import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Tables} from "@/api/db/tables.ts";
import React from "react";
import {Tax} from "@/api/model/tax.ts";
import {Button} from "@/components/common/input/button.tsx";
import {DualCurrency} from "@/components/common/currency/dual-currency.tsx";
import {formatTaxLabel} from "@/lib/tax-label.ts";
import {cn} from "@/lib/utils.ts";
import {useTranslation} from "react-i18next";

interface Props {
  /** Order-level tax (payment type or manual pick); replaces the items' own taxes. */
  tax?: Tax
  setTax: (tax?: Tax) => void
  /** Every tax this order carries, removed ones included, with its full amount. */
  rows: Array<{ tax: Tax; amount: number }>
  excludedTaxIds: string[]
  setExcludedTaxIds: (ids: string[]) => void
  /** The items carry no tax of their own: one tax is picked for the whole order. */
  pickOne?: boolean
  disabled?: boolean
}

const idOf = (tax: Tax) => String(tax.id ?? '');

export const OrderPaymentTax = ({
  tax, setTax, rows, excludedTaxIds, setExcludedTaxIds, pickOne, disabled
}: Props) => {
  const {t} = useTranslation('payment');

  const {
    data: taxes
  } = useApi<SettingsData<Tax>>(Tables.taxes, ['deleted_at = none'], ['priority asc'], 0, 99999);

  const excluded = new Set(excludedTaxIds);
  const allRemoved = rows.length > 0 && rows.every(row => excluded.has(idOf(row.tax)));

  const toggle = (id: string) => {
    setExcludedTaxIds(
      excluded.has(id) ? excludedTaxIds.filter(item => item !== id) : [...excludedTaxIds, id]
    );
  };

  // Every known tax, so one brought later by a payment type stays off too.
  const removeAll = () => {
    const ids = new Set([
      ...rows.map(row => idOf(row.tax)),
      ...(taxes?.data ?? []).map(idOf),
    ]);
    ids.delete('');
    setExcludedTaxIds([...ids]);
  };

  if (pickOne || rows.length === 0) {
    return (
      <div className="flex flex-col gap-3 h-full overflow-auto" data-testid="payment-panel-tax">
        <div className="text-lg font-bold">{t('tax.title')}</div>
        <p className="text-sm text-neutral-500">{t('tax.pickOne')}</p>
        <Button
          variant="danger"
          active={tax === undefined}
          disabled={disabled}
          onClick={() => setTax(undefined)}
          size="lg"
        >
          {t('tax.noTax')}
        </Button>
        {taxes?.data?.map(item => (
          <Button
            variant="primary"
            active={idOf(item) === (tax ? idOf(tax) : undefined)}
            disabled={disabled}
            key={idOf(item)}
            onClick={() => {
              setExcludedTaxIds(excludedTaxIds.filter(id => id !== idOf(item)));
              setTax(item);
            }}
            size="lg"
          >
            {formatTaxLabel(item.name, item.rate)}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full" data-testid="payment-panel-tax">
      <div className="text-lg font-bold">{t('tax.title')}</div>
      <p className="text-sm text-neutral-500">{t('tax.toggleHint')}</p>
      <div className="flex flex-col gap-3 flex-1 min-h-0 overflow-auto">
        {rows.map(row => {
          const id = idOf(row.tax);
          const removed = excluded.has(id);
          return (
            <button
              type="button"
              key={id}
              disabled={disabled}
              aria-pressed={!removed}
              data-testid="payment-tax-toggle"
              onClick={() => toggle(id)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left min-h-[64px]",
                removed
                  ? "border-neutral-300 bg-neutral-100 text-neutral-500"
                  : "border-neutral-900 bg-neutral-900 text-warning-500",
                disabled && "opacity-60"
              )}
            >
              <span className="flex flex-col">
                <span className={cn("text-lg font-bold", removed && "line-through")}>
                  {formatTaxLabel(row.tax.name, row.tax.rate)}
                </span>
                <span className="text-sm">{removed ? t('tax.removed') : t('tax.applied')}</span>
              </span>
              <span className={cn("text-right font-bold", removed && "line-through")}>
                <DualCurrency amount={row.amount} secondaryClassName="text-inherit opacity-70"/>
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="danger"
          size="lg"
          active={allRemoved}
          disabled={disabled}
          data-testid="payment-tax-remove-all"
          onClick={removeAll}
        >
          {t('tax.noTax')}
        </Button>
        <Button
          variant="primary"
          size="lg"
          active={excludedTaxIds.length === 0}
          disabled={disabled}
          data-testid="payment-tax-restore-all"
          onClick={() => setExcludedTaxIds([])}
        >
          {t('tax.allTaxes')}
        </Button>
      </div>
    </div>
  );
}
