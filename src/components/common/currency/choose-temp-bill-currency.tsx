import { createRoot } from "react-dom/client";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/common/input/button.tsx";
import {
  getAppCurrency,
  getCurrencySymbol,
  getPayableCurrencies,
  type PayCurrencyCode,
  shouldShowSecondaryCurrency,
} from "@/lib/currency.ts";
import { useCurrencyDisplay } from "@/hooks/useCurrencyDisplay.ts";
import { cn } from "@/lib/utils.ts";

type DocumentKind = "temp" | "proforma" | "folio";

type Props = {
  defaultCurrency?: PayCurrencyCode;
  documentKind?: DocumentKind;
  onChoose: (code: PayCurrencyCode) => void;
  onCancel: () => void;
};

function printCurrencyCopy(documentKind: DocumentKind): { titleKey: string; hintKey: string } {
  if (documentKind === "proforma") {
    return { titleKey: "printCurrency.proformaTitle", hintKey: "printCurrency.proformaHint" };
  }
  if (documentKind === "folio") {
    return { titleKey: "printCurrency.folioTitle", hintKey: "printCurrency.folioHint" };
  }
  return { titleKey: "printCurrency.title", hintKey: "printCurrency.hint" };
}

function TempBillCurrencyDialog({ defaultCurrency, documentKind = "temp", onChoose, onCancel }: Props) {
  const { t } = useTranslation("orders");
  useCurrencyDisplay();
  const options = getPayableCurrencies();
  const preferred = defaultCurrency && options.includes(defaultCurrency)
    ? defaultCurrency
    : (getAppCurrency() as PayCurrencyCode);
  const copy = printCurrencyCopy(documentKind);

  return (
    <ModalOverlay
      isDismissable
      isOpen
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      className={cn(
        "react-aria-ModalOverlay delete-confirm-overlay !z-[1100] flex items-center justify-center p-4",
      )}
      data-testid="temp-bill-currency-overlay"
    >
      <Modal
        className={({ isEntering, isExiting }) => cn(
          "w-full max-w-md outline-hidden",
          isEntering && "animate-in zoom-in-95 ease-out duration-300",
          isExiting && "animate-out zoom-out-95 ease-in duration-200",
        )}
        isOpen
      >
        <Dialog
          role="alertdialog"
          className="max-w-md max-h-full overflow-hidden rounded-2xl bg-white p-6 box-border text-left shadow-xl relative min-w-[320px]"
          data-testid="temp-bill-currency-dialog"
        >
          <Heading slot="title" className="text-2xl font-semibold leading-6 my-0 text-neutral-700">
            {t(copy.titleKey)}
          </Heading>
          <p className="mt-3 text-neutral-600">
            {t(copy.hintKey)}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            {options.map((code) => (
              <Button
                key={code}
                type="button"
                size="lg"
                variant="primary"
                filled={code === preferred}
                className="w-full justify-center"
                data-testid={`temp-bill-currency-${code.toLowerCase()}`}
                onClick={() => onChoose(code)}
              >
                {code} ({getCurrencySymbol(code)})
              </Button>
            ))}
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="w-full justify-center"
              data-testid="temp-bill-currency-cancel"
              onClick={onCancel}
            >
              {t("printCurrency.cancel")}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

/**
 * Ask which currency to print the prebill / proforma / stay folio in (HTG / USD).
 * Resolves to the chosen code, or null if cancelled.
 * When dual currency is not configured, resolves immediately to the app currency.
 *
 * `onBeforeResolve` runs synchronously on the currency button click (before the
 * dialog unmounts) so callers can open a print window without losing the user gesture.
 */
export function chooseTempBillCurrency(opts?: {
  defaultCurrency?: PayCurrencyCode;
  documentKind?: DocumentKind;
  onBeforeResolve?: (code: PayCurrencyCode) => void;
}): Promise<PayCurrencyCode | null> {
  if (!shouldShowSecondaryCurrency()) {
    const code = getAppCurrency() as PayCurrencyCode;
    opts?.onBeforeResolve?.(code);
    return Promise.resolve(code);
  }

  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const finish = (value: PayCurrencyCode | null) => {
      root.unmount();
      container.remove();
      resolve(value);
    };

    root.render(
      <TempBillCurrencyDialog
        defaultCurrency={opts?.defaultCurrency}
        documentKind={opts?.documentKind}
        onChoose={(code) => {
          opts?.onBeforeResolve?.(code);
          finish(code);
        }}
        onCancel={() => finish(null)}
      />,
    );
  });
}
