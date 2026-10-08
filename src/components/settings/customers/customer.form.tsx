import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDB } from '@/api/db/db.ts';
import type { Customer } from '@/api/model/customer.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Input } from '@/components/common/input/input.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { PhoneInput } from '@/components/customer/phone.input.tsx';
import { appPage } from '@/store/jotai.ts';
import {
  CustomerIdDocumentTakenError,
  sameCustomer,
  updateCustomer,
} from '@/lib/customer.service.ts';
import {
  findCustomerByIdDocument,
  ID_DOCUMENT_TYPES,
  maskIdDocument,
  normalizeIdDocument,
} from '@/lib/customer-id-document.ts';
import { canRegisterGuestFromSearch } from '@/lib/guest.ts';
import { maskPhone } from '@/lib/phone.ts';

interface Props {
  customer?: Customer;
  canViewIdDocument: boolean;
  canViewPhone: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Identity of a customer: name, phone, email, ID document (Manage > Clients). */
export const CustomerForm = ({ customer, canViewIdDocument, canViewPhone, onClose, onSaved }: Props) => {
  const { t } = useTranslation(['admin', 'menu', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [idType, setIdType] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customer) return;
    setName(customer.name ?? '');
    // Without the right to see it, the phone is never prefilled: typing replaces it.
    setPhone(canViewPhone && customer.phone != null ? String(customer.phone) : '');
    setEmail(customer.email ?? '');
    setIdType(customer.id_document_type ?? '');
    // Without the right to see it, the ID is never prefilled: typing replaces it.
    setIdNumber(canViewIdDocument ? customer.id_document_number ?? '' : '');
  }, [customer, canViewIdDocument, canViewPhone]);

  if (!customer) return null;

  const save = async () => {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (!canRegisterGuestFromSearch(cleanName)) {
      toast.error(t('menu:guest.nameRequired'));
      return;
    }
    const number = normalizeIdDocument(idNumber);
    setSaving(true);
    try {
      if (number && number !== customer.id_document_number) {
        const holder = await findCustomerByIdDocument(db, number);
        if (holder && !sameCustomer(holder.id, customer.id)) {
          toast.error(t('menu:guest.idDocumentTaken', { name: holder.name || holder.guest_code || '' }));
          return;
        }
      }
      const phoneValue = phone.trim();
      await updateCustomer(
        db,
        customer.id,
        {
          name: cleanName,
          // Hidden phone left empty: keep the stored one.
          ...(phoneValue || canViewPhone ? { phone: phoneValue || null } : {}),
          email,
          id_document_type: idType || null,
          // Hidden ID left empty: keep the stored one.
          ...(number || canViewIdDocument ? { id_document_number: number || null } : {}),
        },
        page?.user,
      );
      toast.success(t('admin:customers.saved'));
      onSaved();
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t('menu:guest.idDocumentTaken', { name: '' })
          : t('admin:customers.saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={t('admin:customers.editTitle')} size="md" testId="customer-form">
      <div className="space-y-3">
        <Input label={t('menu:customer.name')} value={name} onChange={(event) => setName(event.target.value)} />
        <div>
          <PhoneInput label={t('menu:guest.phone')} value={phone} onChange={setPhone} testId="customer-form-phone" />
          {!canViewPhone && customer.phone != null && String(customer.phone).trim() ? (
            <p className="text-sm text-neutral-500 mt-1">{maskPhone(customer.phone)}</p>
          ) : null}
        </div>
        <Input
          label={t('admin:customers.email')}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex flex-col">
            <label htmlFor="customer-form-id-type">{t('menu:customer.idDocumentType')}</label>
            <select
              id="customer-form-id-type"
              className="input"
              value={idType}
              onChange={(event) => setIdType(event.target.value)}
            >
              <option value="">—</option>
              {ID_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>{t(`menu:customer.idType.${type}`)}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <Input
              label={t('menu:guest.idDocument')}
              placeholder={
                !canViewIdDocument && customer.id_document_number
                  ? maskIdDocument(customer.id_document_number)
                  : t('menu:guest.idDocumentPlaceholder')
              }
              value={idNumber}
              autoComplete="off"
              onChange={(event) => setIdNumber(event.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
          <Button variant="neutral" flat disabled={saving} onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button variant="primary" filled isLoading={saving} onClick={() => void save()} data-testid="customer-form-save">
            {t('common:actions.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
