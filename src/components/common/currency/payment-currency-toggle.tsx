import { Button } from "@/components/common/input/button.tsx";
import {
  getCurrencySymbol,
  getPayableCurrencies,
  type PayCurrencyCode,
  shouldShowSecondaryCurrency,
} from "@/lib/currency.ts";
import { useTranslation } from "react-i18next";
import { useCurrencyDisplay } from "@/hooks/useCurrencyDisplay.ts";

interface Props {
  value: PayCurrencyCode;
  onChange: (code: PayCurrencyCode) => void;
  className?: string;
}

/** USD / HTG tender switch — only when an exchange rate is configured. */
export function PaymentCurrencyToggle({ value, onChange, className }: Props) {
  const { t } = useTranslation("payment");
  useCurrencyDisplay();
  const options = getPayableCurrencies();

  if (!shouldShowSecondaryCurrency() || options.length < 2) {
    return null;
  }

  return (
    <div className={className} data-testid="payment-currency-toggle">
      <p className="text-sm text-neutral-500 mb-2 text-center">
        {t("receiving.payIn")}
      </p>
      <div className="flex justify-center gap-2">
        {options.map((code) => (
          <Button
            key={code}
            type="button"
            size="lg"
            variant="primary"
            active={value === code}
            data-testid={`payment-currency-${code.toLowerCase()}`}
            onClick={() => onChange(code)}
          >
            {code} ({getCurrencySymbol(code)})
          </Button>
        ))}
      </div>
    </div>
  );
}
