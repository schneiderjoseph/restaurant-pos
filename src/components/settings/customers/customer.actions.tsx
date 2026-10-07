import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Input } from '@/components/common/input/input.tsx';
import { Textarea } from '@/components/common/input/textarea.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { appPage } from '@/store/jotai.ts';
import {
  ACTIVE_CUSTOMER,
  CustomerIdDocumentTakenError,
  customerNumberLabel,
  mergeCustomers,
  parseCustomerNumber,
  sameCustomer,
  softDeleteCustomer,
} from '@/lib/customer.service.ts';
import { formatGuestLabel, phoneDigits } from '@/lib/guest.ts';
import { maskPhone } from '@/lib/phone.ts';
import { cn } from '@/lib/utils.ts';

interface DeleteProps {
  customer?: Customer;
  onClose: () => void;
  onDone: () => void;
}

/** Soft delete with a reason: the customer leaves every list, its orders stay, it can be restored. */
export const CustomerDeleteModal = ({ customer, onClose, onDone }: DeleteProps) => {
  const { t } = useTranslation(['admin', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setReason(''), [customer?.id]);

  if (!customer) return null;

  const confirm = async () => {
    setSaving(true);
    try {
      await softDeleteCustomer(db, customer.id, { reason, user: page?.user });
      toast.success(t('admin:customers.deleted', { name: formatGuestLabel(customer) }));
      onDone();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(t('admin:customers.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('admin:customers.deleteTitle', { name: formatGuestLabel(customer) })} size="md" testId="customer-delete">
      <p className="text-neutral-600 mb-3">{t('admin:customers.deleteHint')}</p>
      <Textarea
        rows={2}
        placeholder={t('admin:customers.deleteReasonPlaceholder')}
        value={reason}
        onChange={(event) => setReason((event.target as HTMLTextAreaElement).value)}
      />
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="neutral" flat disabled={saving} onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="danger" filled isLoading={saving} onClick={() => void confirm()} data-testid="customer-delete-confirm">
          {t('common:actions.delete')}
        </Button>
      </div>
    </Modal>
  );
};

interface MergeProps {
  /** The duplicate: it is folded into the customer picked here. */
  customer?: Customer;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Folds a duplicate into the right customer. The duplicate's orders show with the kept customer,
 * its missing details and preferences are copied over; it stays restorable.
 */
export const CustomerMergeModal = ({ customer, onClose, onDone }: MergeProps) => {
  const { t } = useTranslation(['admin', 'menu', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [target, setTarget] = useState<Customer | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSearch(customer?.name ?? '');
    setTarget(undefined);
  }, [customer?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per duplicate

  useEffect(() => {
    if (!customer) return;
    const term = search.trim().toLowerCase();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      const digits = /\p{L}/u.test(term) ? '' : phoneDigits(term);
      void db
        .query<Customer[]>(
          `SELECT * FROM ${Tables.customers}
           WHERE ${ACTIVE_CUSTOMER} AND id != $self AND (
             string::contains(string::lowercase(name ?? ''), $term)
             OR ($digits != '' AND string::contains(phone_e164 ?? '', $digits))
             OR ($number != NONE AND number = $number)
           )
           ORDER BY name LIMIT 30`,
          { term, digits: digits.length >= 3 ? digits : '', number: parseCustomerNumber(term) ?? undefined, self: customer.id },
        )
        .then(([rows]) => {
          if (!cancelled) setResults(Array.isArray(rows) ? rows : []);
        })
        .catch((error) => {
          console.error('Merge search failed', error);
          if (!cancelled) setResults([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on the typed term
  }, [search, customer?.id]);

  if (!customer) return null;

  const confirm = async () => {
    if (!target || sameCustomer(target.id, customer.id)) return;
    setSaving(true);
    try {
      await mergeCustomers(db, target, customer, page?.user);
      toast.success(t('admin:customers.merged', { from: formatGuestLabel(customer), to: formatGuestLabel(target) }));
      onDone();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t('menu:guest.idDocumentTaken', { name: '' })
          : t('admin:customers.mergeFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const describe = (item: Customer) =>
    [customerNumberLabel(item), maskPhone(item.phone), item.room ? `${t('menu:guest.room')} ${item.room}` : '']
      .filter(Boolean)
      .join(' · ');

  return (
    <Modal open onClose={onClose} title={t('admin:customers.mergeTitle', { name: formatGuestLabel(customer) })} size="md" testId="customer-merge">
      <p className="text-neutral-600 mb-3">{t('admin:customers.mergeHint')}</p>
      <div className="rounded-lg bg-neutral-100 p-3 mb-3">
        <div className="text-xs uppercase text-neutral-500">{t('admin:customers.mergeDuplicate')}</div>
        <div className="font-semibold">{formatGuestLabel(customer)}</div>
        <div className="text-sm text-neutral-600">{describe(customer)}</div>
      </div>
      <Input
        label={t('admin:customers.mergeKeep')}
        placeholder={t('admin:customers.searchPlaceholder')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        data-testid="customer-merge-search"
      />
      <div className="divide-y rounded-lg border border-neutral-200 max-h-[35vh] overflow-auto mt-2">
        {results.map((item) => (
          <button
            key={item.id?.toString()}
            type="button"
            className={cn(
              'w-full text-left px-3 py-2 hover:bg-primary-50',
              target && sameCustomer(target.id, item.id) && 'bg-primary-100',
            )}
            onClick={() => setTarget(item)}
            data-testid="customer-merge-option"
          >
            <div className="font-semibold">{formatGuestLabel(item)}</div>
            <div className="text-sm text-neutral-600">{describe(item)}</div>
          </button>
        ))}
      </div>
      {target && (
        <p className="mt-3 text-sm" data-testid="customer-merge-summary">
          {t('admin:customers.mergeSummary', { from: formatGuestLabel(customer), to: formatGuestLabel(target) })}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <Button variant="neutral" flat disabled={saving} onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="primary"
          filled
          disabled={!target}
          isLoading={saving}
          onClick={() => void confirm()}
          data-testid="customer-merge-confirm"
        >
          {t('admin:customers.mergeConfirm')}
        </Button>
      </div>
    </Modal>
  );
};
