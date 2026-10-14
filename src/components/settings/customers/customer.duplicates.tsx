import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { faCodeMerge, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { Customer } from '@/api/model/customer.ts';
import { useDB } from '@/api/db/db.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { customerNumberLabel, findLikelyDuplicateWalkIns } from '@/lib/customer.service.ts';
import { formatGuestLabel } from '@/lib/guest.ts';
import { maskPhone } from '@/lib/phone.ts';

interface Props {
  /** Changes after a merge, to look again. */
  refreshKey: number;
  /** Fold `duplicate` into `keep` (the oldest file of its group). */
  onMerge: (duplicate: Customer, keep: Customer) => void;
}

/**
 * Manage > Clients: walk-ins registered more than once (same phone, look-alike name), to merge.
 * Shows nothing when there are none.
 */
export const CustomerDuplicatesBanner = ({ refreshKey, onMerge }: Props) => {
  const { t } = useTranslation(['admin', 'common']);
  const db = useDB();
  const [groups, setGroups] = useState<Customer[][]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    findLikelyDuplicateWalkIns(db)
      .then((found) => {
        if (!cancelled) setGroups(found);
      })
      .catch((error) => console.error('Duplicate walk-in lookup failed', error));
    return () => {
      cancelled = true;
    };
  }, [db, refreshKey]);

  if (groups.length === 0) return null;

  return (
    <>
      <div
        className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-warning-300 bg-warning-50 px-4 py-3 text-warning-900"
        data-testid="customers-duplicates-banner"
      >
        <FontAwesomeIcon icon={faTriangleExclamation} />
        <span className="flex-1 font-semibold">{t('admin:customers.duplicates.banner', { count: groups.length })}</span>
        <Button variant="warning" flat onClick={() => setOpen(true)} data-testid="customers-duplicates-open">
          {t('admin:customers.duplicates.review')}
        </Button>
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('admin:customers.duplicates.title', { count: groups.length })}
        size="lg"
        testId="customers-duplicates"
      >
        <p className="mb-3 text-neutral-600">{t('admin:customers.duplicates.hint')}</p>
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {groups.map((group) => {
            const [keep, ...duplicates] = group;
            return (
              <div key={keep.id?.toString()} className="rounded-lg border border-neutral-200" data-testid="customers-duplicates-group">
                <div className="border-b bg-neutral-50 px-3 py-2">
                  <div className="text-xs uppercase text-neutral-500">{t('admin:customers.duplicates.keep')}</div>
                  <div className="font-semibold">{formatGuestLabel(keep)}</div>
                  <div className="text-sm text-neutral-600">
                    {[customerNumberLabel(keep), maskPhone(keep.phone)].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {duplicates.map((duplicate) => (
                  <div key={duplicate.id?.toString()} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{formatGuestLabel(duplicate)}</div>
                      <div className="text-sm text-neutral-600">{customerNumberLabel(duplicate)}</div>
                    </div>
                    <Button
                      variant="primary"
                      flat
                      icon={faCodeMerge}
                      onClick={() => {
                        setOpen(false);
                        onMerge(duplicate, keep);
                      }}
                      data-testid="customers-duplicates-merge"
                    >
                      {t('admin:customers.merge')}
                    </Button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="neutral" flat onClick={() => setOpen(false)}>{t('common:actions.close')}</Button>
        </div>
      </Modal>
    </>
  );
};
