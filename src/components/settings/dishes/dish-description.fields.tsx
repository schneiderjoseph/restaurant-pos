import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Textarea } from '@/components/common/input/textarea.tsx';
import { SUPPORTED_LANGUAGES } from '@/lib/languages.ts';

/** Always offered: the house menu is written in French and English. */
const DEFAULT_LANGUAGES = ['fr', 'en'];

const languageLabel = (code: string) =>
  SUPPORTED_LANGUAGES.find((lang) => lang.code === code)?.label ?? code.toUpperCase();

interface Props {
  value?: Record<string, string> | null;
  onChange: (value: Record<string, string>) => void;
}

/** One text per language for the dish description; other app languages can be added. */
export const DishDescriptionFields = ({ value, onChange }: Props) => {
  const { t } = useTranslation('admin');
  const [added, setAdded] = useState<string[]>([]);
  const shown = [...new Set([...DEFAULT_LANGUAGES, ...Object.keys(value ?? {}), ...added])];
  const remaining = SUPPORTED_LANGUAGES.filter((lang) => !shown.includes(lang.code));

  return (
    <div className="flex flex-col gap-2 mb-3" data-testid="dish-description-fields">
      <label>{t('forms.dishDescription')}</label>
      <p className="text-sm text-neutral-500 -mt-1">{t('forms.dishDescriptionHint')}</p>
      {shown.map((code) => (
        <div key={code} className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-neutral-700">{languageLabel(code)}</span>
          <Textarea
            rows={2}
            lang={code}
            value={value?.[code] ?? ''}
            onChange={(event) =>
              onChange({ ...(value ?? {}), [code]: (event.target as HTMLTextAreaElement).value })
            }
            data-testid={`dish-description-input-${code}`}
          />
        </div>
      ))}
      {remaining.length > 0 && (
        <select
          className="form-control max-w-xs"
          value=""
          aria-label={t('forms.addDescriptionLanguage')}
          data-testid="dish-description-add-language"
          onChange={(event) => {
            const code = event.target.value;
            if (code) setAdded((prev) => [...prev, code]);
          }}
        >
          <option value="">{t('forms.addDescriptionLanguage')}</option>
          {remaining.map((lang) => (
            <option key={lang.code} value={lang.code}>{lang.label}</option>
          ))}
        </select>
      )}
    </div>
  );
};
