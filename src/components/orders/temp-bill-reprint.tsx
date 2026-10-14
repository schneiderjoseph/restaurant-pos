import { createRoot } from "react-dom/client";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/common/input/button.tsx";
import i18n from "@/lib/i18n.ts";
import { lastOrderPrintAt, tempBillCooldownLeft } from "@/lib/order-print.ts";
import { cn } from "@/lib/utils.ts";

type PrintDB = Parameters<typeof lastOrderPrintAt>[0];

/** A temp bill flow still waiting for its print, by order: a second tap is ignored meanwhile. */
const inFlight = new Map<string, number>();
/** This device's last temp bill per order, before the database record is readable. */
const printedHere = new Map<string, number>();
/** A flow whose approval prompt was dismissed never settles: let it go after this. */
const IN_FLIGHT_MAX_MS = 15_000;

function ReprintDialog({ secondsAgo, onAnswer }: { secondsAgo: number; onAnswer: (reprint: boolean) => void }) {
  const { t } = useTranslation("orders");
  return (
    <ModalOverlay
      isDismissable
      isOpen
      onOpenChange={(open) => {
        if (!open) onAnswer(false);
      }}
      className="react-aria-ModalOverlay delete-confirm-overlay !z-[1100] flex items-center justify-center p-4"
      data-testid="temp-bill-reprint-overlay"
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
          data-testid="temp-bill-reprint-dialog"
        >
          <Heading slot="title" className="text-2xl font-semibold leading-6 my-0 text-neutral-700">
            {t("tempReprint.title")}
          </Heading>
          <p className="mt-3 text-neutral-600">{t("tempReprint.hint", { seconds: secondsAgo })}</p>
          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="button"
              size="lg"
              variant="secondary"
              filled
              className="w-full justify-center"
              data-testid="temp-bill-reprint-cancel"
              onClick={() => onAnswer(false)}
            >
              {t("tempReprint.cancel")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="warning"
              className="w-full justify-center"
              data-testid="temp-bill-reprint-confirm"
              onClick={() => onAnswer(true)}
            >
              {t("tempReprint.confirm")}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

function askReprint(secondsAgo: number): Promise<boolean> {
  return new Promise((resolve) => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(
      <ReprintDialog
        secondsAgo={secondsAgo}
        onAnswer={(reprint) => {
          root.unmount();
          container.remove();
          resolve(reprint);
        }}
      />,
    );
  });
}

/**
 * Before a temp bill: false when it must not print. A tap while the previous one is still
 * printing is ignored; within 45 s of the last print (any device) staff confirm the reprint.
 * Every true must be followed by endTempBillPrint.
 */
export async function beginTempBillPrint(db: PrintDB, orderId: string): Promise<boolean> {
  const now = Date.now();
  const started = inFlight.get(orderId);
  if (started && now - started < IN_FLIGHT_MAX_MS) {
    toast.info(i18n.t("orders:tempReprint.busy"));
    return false;
  }
  inFlight.set(orderId, now);

  // A failed lookup must not block the print.
  const fromDb = await lastOrderPrintAt(db, orderId, "temp").catch(() => null);
  const here = printedHere.get(orderId);
  const last = Math.max(fromDb?.getTime() ?? 0, here ?? 0);
  if (tempBillCooldownLeft(last ? new Date(last) : null) > 0) {
    const reprint = await askReprint(Math.max(1, Math.round((Date.now() - last) / 1000)));
    if (!reprint) {
      inFlight.delete(orderId);
      return false;
    }
  }
  return true;
}

/** Ends a flow started by beginTempBillPrint (printed, failed or cancelled). */
export function endTempBillPrint(orderId: string, printed: boolean): void {
  inFlight.delete(orderId);
  if (printed) {
    printedHere.set(orderId, Date.now());
  }
}
