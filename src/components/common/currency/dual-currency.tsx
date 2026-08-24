import { cn } from '@/lib/utils.ts';
import { withCurrency } from '@/lib/utils.ts';
import { formatSecondaryCurrency, shouldShowSecondaryCurrency } from '@/lib/currency.ts';
import { useCurrencyDisplay } from '@/hooks/useCurrencyDisplay.ts';

interface DualCurrencyProps {
  amount: string | number | undefined;
  className?: string;
  /** Stack secondary under primary (default) or inline. */
  layout?: 'stack' | 'inline';
  primaryClassName?: string;
  secondaryClassName?: string;
}

/** Primary amount + optional HTG (or inverse) line when exchange rate is configured. */
export function DualCurrency({
  amount,
  className,
  layout = 'stack',
  primaryClassName,
  secondaryClassName,
}: DualCurrencyProps) {
  useCurrencyDisplay();
  const secondary = formatSecondaryCurrency(amount);

  if (!shouldShowSecondaryCurrency() || !secondary) {
    return (
      <span className={cn('tabular-nums', className, primaryClassName)}>
        {withCurrency(amount)}
      </span>
    );
  }

  if (layout === 'inline') {
    return (
      <span className={cn('tabular-nums', className)}>
        <span className={primaryClassName}>{withCurrency(amount)}</span>
        <span className={cn('text-neutral-500 text-sm ml-1', secondaryClassName)}>
          ({secondary})
        </span>
      </span>
    );
  }

  return (
    <div className={cn('flex flex-col items-end leading-tight', className)}>
      <span className={cn('tabular-nums font-inherit', primaryClassName)}>
        {withCurrency(amount)}
      </span>
      <span className={cn('tabular-nums text-xs text-neutral-500', secondaryClassName)}>
        {secondary}
      </span>
    </div>
  );
}
