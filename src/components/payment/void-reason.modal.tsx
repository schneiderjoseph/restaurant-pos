import {useEffect, useState} from "react";
import {useTranslation} from "react-i18next";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {OrderVoidReason} from "@/api/model/order_void.ts";
import {translateVoidReason} from "@/lib/order.ts";

interface VoidReasonModalProps {
  open: boolean
  /** Dish lines taken off, for the server to check what they are about to remove. */
  lines: string[]
  onConfirm: (reason: OrderVoidReason) => void
  onClose: () => void
}

/** "Testing" is for the admin cancel screen, not for a server at the till. */
const REASONS = Object.values(OrderVoidReason).filter((reason) => reason !== OrderVoidReason.Testing);

/**
 * Asked when a send takes money off lines already sent (removed or fewer plates): the reason
 * goes on the voids, directly or through the approval request, so reports say why.
 */
export const VoidReasonModal = ({open, lines, onConfirm, onClose}: VoidReasonModalProps) => {
  const {t} = useTranslation('payment');
  const {t: tOrders} = useTranslation('orders');
  const [reason, setReason] = useState<OrderVoidReason>(OrderVoidReason.PunchByMistake);

  useEffect(() => {
    if (open) {
      setReason(OrderVoidReason.PunchByMistake);
    }
  }, [open]);

  return (
    <Modal testId="void-reason-modal" open={open} onClose={onClose} title={t('payment:voidReason.title')} size="md">
      <div className="flex flex-col gap-4">
        {lines.length > 0 && (
          <ul className="text-base font-normal text-neutral-700 list-disc pl-5" data-testid="void-reason-lines">
            {lines.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {REASONS.map((option) => (
            <button
              key={option}
              type="button"
              data-testid={`void-reason-${option}`}
              className={`rounded-xl border-2 px-3 py-4 text-base font-semibold transition text-center ${
                reason === option
                  ? 'border-danger-500 bg-danger-100/30 text-danger-600'
                  : 'border-neutral-200 bg-white hover:border-neutral-400'
              }`}
              onClick={() => setReason(option)}
            >
              {translateVoidReason(tOrders, option)}
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <Button flat variant="secondary" size="lg" onClick={onClose} data-testid="void-reason-back">
            {t('payment:voidReason.back')}
          </Button>
          <Button variant="danger" size="lg" onClick={() => onConfirm(reason)} data-testid="void-reason-confirm">
            {t('payment:voidReason.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
