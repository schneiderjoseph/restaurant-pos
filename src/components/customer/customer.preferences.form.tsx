import { useEffect, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useDB } from '@/api/db/db.ts';
import type { Customer } from '@/api/model/customer.ts';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Input } from '@/components/common/input/input.tsx';
import { Textarea } from '@/components/common/input/textarea.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { Switch } from '@/components/common/input/switch.tsx';
import { appPage } from '@/store/jotai.ts';
import { cleanList, updateCustomer } from '@/lib/customer.service.ts';
import { COMMON_ALLERGENS, DIETS } from '@/lib/customer-preferences.ts';
import { cn } from '@/lib/utils.ts';

interface Props {
  open: boolean;
  customer: Customer;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

const Chip = ({ active, onClick, children, testId }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    data-testid={testId}
    className={cn(
      'rounded-full border px-3 py-2 min-h-[44px] text-base',
      active
        ? 'bg-primary-500 border-primary-500 text-white font-semibold'
        : 'bg-white border-neutral-300 text-neutral-700 hover:bg-neutral-100',
    )}
  >
    {children}
  </button>
);

/** Allergies, diet, seating, language, birthday, VIP, consent and note of one customer. */
export const CustomerPreferencesForm = ({ open, customer, onClose, onSaved }: Props) => {
  const { t } = useTranslation(['menu', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);

  const [allergies, setAllergies] = useState<string[]>([]);
  const [allergyDraft, setAllergyDraft] = useState('');
  const [diets, setDiets] = useState<string[]>([]);
  const [seating, setSeating] = useState('');
  const [language, setLanguage] = useState('');
  const [birthday, setBirthday] = useState('');
  const [vip, setVip] = useState(false);
  const [consent, setConsent] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setAllergies(cleanList(customer.allergies));
    setAllergyDraft('');
    setDiets(cleanList(customer.dietary));
    setSeating(customer.seating_pref ?? '');
    setLanguage(customer.language ?? '');
    setBirthday(customer.birthday ?? '');
    setVip(Boolean(customer.vip));
    setConsent(Boolean(customer.marketing_consent));
    setNotes(customer.notes ?? '');
  }, [open, customer]);

  const allergenLabel = (key: string) => t(`menu:customer.allergen.${key}`);
  const hasAllergy = (label: string) =>
    allergies.some((item) => item.toLowerCase() === label.toLowerCase());

  const toggleAllergy = (label: string) => {
    setAllergies((prev) => {
      const exists = prev.some((item) => item.toLowerCase() === label.toLowerCase());
      return exists
        ? prev.filter((item) => item.toLowerCase() !== label.toLowerCase())
        : [...prev, label];
    });
  };

  const addAllergyDraft = () => {
    const text = allergyDraft.trim();
    if (!text) return;
    setAllergies((prev) => cleanList([...prev, ...text.split(/[,;]/)]));
    setAllergyDraft('');
  };

  const toggleDiet = (key: string) => {
    setDiets((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));
  };

  const save = async () => {
    setSaving(true);
    try {
      const pendingAllergies = allergyDraft.trim()
        ? cleanList([...allergies, ...allergyDraft.split(/[,;]/)])
        : allergies;
      const updated = await updateCustomer(
        db,
        customer.id,
        {
          allergies: pendingAllergies,
          dietary: diets,
          seating_pref: seating,
          language,
          birthday,
          vip,
          marketing_consent: consent,
          notes,
        },
        page?.user,
      );
      toast.success(t('menu:customer.preferencesSaved'));
      onSaved({ ...customer, ...updated });
      onClose();
    } catch (error) {
      console.error(error);
      toast.error(t('menu:customer.preferencesSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const customAllergies = allergies.filter(
    (item) => !COMMON_ALLERGENS.some((key) => allergenLabel(key).toLowerCase() === item.toLowerCase()),
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('menu:customer.preferencesTitle', { name: customer.name || customer.guest_code || '' })}
      size="lg"
      testId="customer-preferences"
    >
      <div className="space-y-5">
        <section>
          <h3 className="font-bold text-danger-700 mb-1">{t('menu:customer.allergies')}</h3>
          <p className="text-sm text-neutral-500 mb-2">{t('menu:customer.allergiesHint')}</p>
          <div className="flex flex-wrap gap-2">
            {COMMON_ALLERGENS.map((key) => (
              <Chip
                key={key}
                active={hasAllergy(allergenLabel(key))}
                onClick={() => toggleAllergy(allergenLabel(key))}
                testId={`customer-allergen-${key}`}
              >
                {allergenLabel(key)}
              </Chip>
            ))}
            {customAllergies.map((item) => (
              <Chip key={item} active onClick={() => toggleAllergy(item)}>
                {item} <FontAwesomeIcon icon={faXmark} className="ml-1" />
              </Chip>
            ))}
          </div>
          <div className="flex gap-2 items-end mt-2">
            <div className="flex flex-col flex-1">
              <Input
                placeholder={t('menu:customer.otherAllergyPlaceholder')}
                value={allergyDraft}
                onChange={(event) => setAllergyDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addAllergyDraft();
                  }
                }}
                data-testid="customer-allergy-input"
              />
            </div>
            <Button variant="primary" flat icon={faPlus} className="min-h-[44px]" onClick={addAllergyDraft}>
              {t('common:actions.add')}
            </Button>
          </div>
        </section>

        <section>
          <h3 className="font-bold mb-2">{t('menu:customer.dietTitle')}</h3>
          <div className="flex flex-wrap gap-2">
            {DIETS.map((key) => (
              <Chip key={key} active={diets.includes(key)} onClick={() => toggleDiet(key)} testId={`customer-diet-${key}`}>
                {t(`menu:customer.diet.${key}`)}
              </Chip>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="flex flex-col">
            <Input
              label={t('menu:customer.seating')}
              placeholder={t('menu:customer.seatingPlaceholder')}
              value={seating}
              onChange={(event) => setSeating(event.target.value)}
            />
          </div>
          <div className="flex flex-col">
            <Input
              label={t('menu:customer.language')}
              placeholder={t('menu:customer.languagePlaceholder')}
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
            />
          </div>
          <div className="flex flex-col">
            <label>{t('menu:customer.birthday')}</label>
            <input
              type="date"
              className="input"
              value={birthday}
              onChange={(event) => setBirthday(event.target.value)}
              data-testid="customer-birthday"
            />
          </div>
        </section>

        <section className="flex flex-wrap gap-8">
          <Switch checked={vip} onChange={(event) => setVip(event.target.checked)}>
            VIP
          </Switch>
          <Switch checked={consent} onChange={(event) => setConsent(event.target.checked)}>
            {t('menu:customer.marketingConsent')}
          </Switch>
        </section>

        <section>
          <label>{t('menu:guest.notes')}</label>
          <Textarea
            rows={3}
            placeholder={t('menu:guest.notePlaceholder')}
            value={notes}
            onChange={(event) => setNotes((event.target as HTMLTextAreaElement).value)}
            data-testid="customer-notes-input"
          />
        </section>

        <div className="flex justify-end gap-2 border-t border-neutral-200 pt-4">
          <Button variant="neutral" flat className="min-h-[48px]" disabled={saving} onClick={onClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="primary"
            filled
            className="min-h-[48px]"
            isLoading={saving}
            onClick={() => void save()}
            data-testid="customer-preferences-save"
          >
            {t('common:actions.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
