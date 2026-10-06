import { useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Input } from '@/components/common/input/input.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { PhoneInput } from '@/components/customer/phone.input.tsx';
import { CustomerMatchesModal } from '@/components/customer/customer.matches.modal.tsx';
import { appPage } from '@/store/jotai.ts';
import {
  canRegisterGuestFromSearch,
  generateWalkInGuestCode,
  previewGuestCode,
} from '@/lib/guest.ts';
import {
  findCustomerByIdDocument,
  hasWalkInContact,
  normalizeIdDocument,
} from '@/lib/customer-id-document.ts';
import {
  createWalkInCustomer,
  CustomerIdDocumentTakenError,
  findWalkInMatches,
  type CustomerMatch,
} from '@/lib/customer.service.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the new (or matched existing) customer. */
  onCreated: (customer: Customer) => void;
}

/** Tiny walk-in registration for contexts that only need a client pick (e.g. split by clients). */
export const QuickCreateCustomerModal = ({ open, onClose, onCreated }: Props) => {
  const { t } = useTranslation(['menu', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [idDocument, setIdDocument] = useState('');
  const [codeOverride, setCodeOverride] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [matches, setMatches] = useState<CustomerMatch[] | null>(null);

  const cleanName = name.trim().replace(/\s+/g, ' ');
  const displayCode = useMemo(() => {
    if (codeOverride) return codeOverride;
    return previewGuestCode(cleanName);
  }, [codeOverride, cleanName]);

  const reset = () => {
    setName('');
    setPhone('');
    setIdDocument('');
    setCodeOverride(null);
    setMatches(null);
    setSaving(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const finish = (customer: Customer) => {
    onCreated(customer);
    reset();
    onClose();
  };

  const create = async (confirmed = false) => {
    if (!canRegisterGuestFromSearch(cleanName)) {
      toast.error(t('menu:guest.nameRequired'));
      return;
    }
    if (!hasWalkInContact({ phone, idDocument })) {
      toast.error(t('menu:guest.contactRequired'));
      return;
    }

    if (normalizeIdDocument(idDocument)) {
      const existing = await findCustomerByIdDocument(db, idDocument).catch((error) => {
        console.error('ID document lookup failed', error);
        return undefined;
      });
      if (existing) {
        toast.message(t('menu:guest.idDocumentExists', {
          name: existing.name || existing.guest_code || '',
        }));
        finish(existing);
        return;
      }
    }

    if (!confirmed) {
      const found = await findWalkInMatches(db, { name: cleanName, phone }).catch((error) => {
        console.error('Walk-in match lookup failed', error);
        return [] as CustomerMatch[];
      });
      if (found.length > 0) {
        setMatches(found);
        return;
      }
    }

    setSaving(true);
    try {
      let guest_code = displayCode.trim().toUpperCase() || generateWalkInGuestCode(cleanName);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const [existing] = await db.query<Customer[]>(
          `SELECT * FROM ${Tables.customers} WHERE guest_code = $code LIMIT 1`,
          { code: guest_code },
        );
        if (!Array.isArray(existing) || !existing[0]) break;
        guest_code = generateWalkInGuestCode(cleanName);
      }

      const created = await createWalkInCustomer(db, {
        name: cleanName,
        guestCode: guest_code,
        phone,
        idDocument,
        createdBy: page?.user,
      });

      toast.success(t('menu:guest.created'));
      finish(created);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t('menu:guest.idDocumentTaken', { name: '' })
          : t('menu:guest.createFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        title={t('menu:guest.createTitle')}
        size="sm"
        testId="split-quick-create-customer"
      >
        <div className="space-y-3">
          <p className="text-sm text-neutral-600">{t('menu:guest.contactHint')}</p>
          <Input
            label={t('menu:customer.name')}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setCodeOverride(null);
            }}
            autoFocus
            data-testid="quick-create-name"
          />
          <PhoneInput
            label={t('menu:guest.phone')}
            value={phone}
            onChange={setPhone}
            testId="quick-create-phone"
          />
          <Input
            label={t('menu:guest.idDocument')}
            placeholder={t('menu:guest.idDocumentPlaceholder')}
            value={idDocument}
            autoComplete="off"
            onChange={(event) => setIdDocument(event.target.value)}
            data-testid="quick-create-id-document"
          />
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label={t('menu:guest.code')}
                value={displayCode}
                readOnly
                data-testid="quick-create-code"
              />
            </div>
            <Button
              type="button"
              variant="neutral"
              flat
              disabled={!cleanName}
              onClick={() => setCodeOverride(generateWalkInGuestCode(cleanName))}
            >
              {t('menu:guest.regenCode')}
            </Button>
          </div>
          <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
            <Button variant="neutral" flat disabled={saving} onClick={handleClose}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              filled
              icon={faCheck}
              isLoading={saving}
              onClick={() => void create()}
              data-testid="quick-create-save"
            >
              {t('menu:guest.register')}
            </Button>
          </div>
        </div>
      </Modal>

      {matches && (
        <CustomerMatchesModal
          open
          name={cleanName}
          matches={matches}
          creating={saving}
          onPick={(customer) => {
            setMatches(null);
            finish(customer);
          }}
          onCreateNew={() => void create(true)}
          onClose={() => setMatches(null)}
        />
      )}
    </>
  );
};
