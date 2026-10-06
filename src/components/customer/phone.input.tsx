import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/common/input/input.tsx';
import {
  countryFlag,
  countryName,
  DEFAULT_PHONE_COUNTRY,
  findPhoneCountry,
  formatPhone,
  PHONE_COUNTRIES,
  PINNED_PHONE_COUNTRY_COUNT,
  splitPhone,
  toE164,
} from '@/lib/phone.ts';

interface Props {
  label?: string;
  /** Stored phone ("+509 3747 3889"), or ''. */
  value?: string | number | null;
  /** The stored international form, or '' while the number is incomplete. */
  onChange: (phone: string) => void;
  autoFocus?: boolean;
  testId?: string;
}

/**
 * Country calling code (Haiti by default) and the national number.
 * Emits the stored international form, so every phone carries its country.
 */
export const PhoneInput = ({ label, value, onChange, autoFocus, testId = 'phone-input' }: Props) => {
  const { t, i18n } = useTranslation('menu');
  const initial = useMemo(() => splitPhone(value), []); // eslint-disable-line react-hooks/exhaustive-deps -- seeded once
  const [iso, setIso] = useState(initial.country.iso);
  const [national, setNational] = useState(initial.national);
  const lastEmitted = useRef(value == null ? '' : String(value));

  // A new value from outside (another customer selected, form reset) replaces the draft.
  useEffect(() => {
    const incoming = value == null ? '' : String(value);
    if (incoming === lastEmitted.current) {
      return;
    }
    const parts = splitPhone(incoming, DEFAULT_PHONE_COUNTRY, iso);
    setIso(parts.country.iso);
    setNational(parts.national);
    lastEmitted.current = incoming;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an outside change resets the draft
  }, [value]);

  const emit = (nextIso: string, nextNational: string) => {
    const phone = formatPhone(findPhoneCountry(nextIso).dial, nextNational);
    lastEmitted.current = phone;
    onChange(phone);
  };

  const options = useMemo(() => {
    const named = PHONE_COUNTRIES.map((country) => ({
      ...country,
      label: `${countryFlag(country.iso)} ${countryName(country.iso, i18n.language)} +${country.dial}`,
    }));
    const pinned = named.slice(0, PINNED_PHONE_COUNTRY_COUNT);
    const rest = named
      .slice(PINNED_PHONE_COUNTRY_COUNT)
      .sort((a, b) => a.label.slice(5).localeCompare(b.label.slice(5), i18n.language));
    return { pinned, rest };
  }, [i18n.language]);

  const country = findPhoneCountry(iso);

  return (
    <div className="flex flex-col w-full" data-testid={testId}>
      {label && <label>{label}</label>}
      <div className="flex gap-2 items-stretch">
        <select
          className="input !w-[9.5rem] shrink-0"
          aria-label={t('guest.phoneCountry')}
          value={iso}
          onChange={(event) => {
            setIso(event.target.value);
            emit(event.target.value, national);
          }}
          data-testid={`${testId}-country`}
        >
          <optgroup label={t('guest.phoneCountriesFrequent')}>
            {options.pinned.map((option) => (
              <option key={option.iso} value={option.iso}>{option.label}</option>
            ))}
          </optgroup>
          <optgroup label={t('guest.phoneCountriesAll')}>
            {options.rest.map((option) => (
              <option key={option.iso} value={option.iso}>{option.label}</option>
            ))}
          </optgroup>
        </select>
        <div className="flex-1 min-w-0">
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder={country.iso === 'HT' ? '3747 3889' : ''}
            value={national}
            autoFocus={autoFocus}
            onChange={(event) => {
              const next = event.target.value;
              // A pasted international number brings its own country.
              if (/^\s*(\+|00)/.test(next) && toE164(next)) {
                const parts = splitPhone(next, iso, iso);
                setIso(parts.country.iso);
                setNational(parts.national);
                emit(parts.country.iso, parts.national);
                return;
              }
              setNational(next);
              emit(iso, next);
            }}
            data-testid={`${testId}-number`}
          />
        </div>
      </div>
    </div>
  );
};
