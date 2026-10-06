import { useTranslation } from 'react-i18next';
import type { Customer } from '@/api/model/customer.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { formatGuestLabel } from '@/lib/guest.ts';
import { customerNumberLabel, type CustomerMatch } from '@/lib/customer.service.ts';
import { maskIdDocument } from '@/lib/customer-id-document.ts';
import { maskPhone } from '@/lib/phone.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';

interface Props {
  open: boolean;
  /** The name being registered. */
  name: string;
  matches: CustomerMatch[];
  creating?: boolean;
  onPick: (customer: Customer) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

/**
 * Before registering a walk-in whose name or phone is already known: the same name is not the
 * same person, so staff pick the right client by number, phone and last visit, or register a
 * new one.
 */
export const CustomerMatchesModal = ({ open, name, matches, creating, onPick, onCreateNew, onClose }: Props) => {
  const { t } = useTranslation(['menu', 'common']);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('menu:customer.matchesTitle', { count: matches.length })}
      size="md"
      testId="customer-matches"
    >
      <p className="text-neutral-600 mb-3">{t('menu:customer.matchesHint', { name })}</p>
      <div className="divide-y rounded-lg border border-neutral-200 max-h-[50vh] overflow-auto">
        {matches.map(({ customer, reasons }) => {
          const details = [
            customerNumberLabel(customer),
            maskPhone(customer.phone),
            customer.id_document_number ? maskIdDocument(customer.id_document_number) : '',
            customer.room ? `${t('menu:guest.room')} ${customer.room}` : '',
            customer.last_order_at
              ? t('menu:guest.lastOrder', { date: toLuxonDateTime(customer.last_order_at).toFormat('dd LLL yyyy') })
              : '',
          ].filter(Boolean);
          return (
            <button
              key={customer.id?.toString()}
              type="button"
              className="w-full text-left px-3 py-2 min-h-[64px] flex items-center gap-3 hover:bg-primary-50 active:bg-primary-100"
              onClick={() => onPick(customer)}
              data-testid="customer-match"
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-lg leading-tight">{formatGuestLabel(customer)}</div>
                <div className="text-sm text-neutral-600">{details.join(' · ')}</div>
              </div>
              <div className="flex flex-col gap-1 items-end shrink-0">
                {reasons.map((reason) => (
                  <span key={reason} className="rounded-md bg-warning-100 text-warning-800 px-2 py-0.5 text-xs font-semibold">
                    {t(reason === 'phone' ? 'menu:customer.samePhone' : 'menu:customer.sameName')}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2 mt-4">
        <Button variant="neutral" flat className="min-h-[48px]" disabled={creating} onClick={onClose}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="primary"
          filled
          className="min-h-[48px]"
          isLoading={creating}
          onClick={onCreateNew}
          data-testid="customer-create-anyway"
        >
          {t('menu:customer.createAnyway', { name })}
        </Button>
      </div>
    </Modal>
  );
};
