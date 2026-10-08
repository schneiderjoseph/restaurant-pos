import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { Dish } from '@/api/model/dish.ts';
import { withCurrency } from '@/lib/utils.ts';
import { dishDescriptionLanguages, pickDishDescription } from '@/lib/dish-description.ts';
import { SUPPORTED_LANGUAGES } from '@/lib/languages.ts';

const languageLabel = (code: string) =>
  SUPPORTED_LANGUAGES.find((lang) => lang.code === code)?.label ?? code.toUpperCase();

interface Props {
  dish: Dish;
  price: number;
  onClose: () => void;
}

/** Opened by a long press on a dish: its description, switchable between the languages it has. */
export const DishDescriptionModal = ({ dish, price, onClose }: Props) => {
  const { t, i18n } = useTranslation('menu');
  const languages = dishDescriptionLanguages(dish.description);
  const initial = pickDishDescription(dish.description, i18n.language);
  const [lang, setLang] = useState(initial?.lang ?? '');
  const text = dish.description?.[lang]?.trim() ?? '';

  return (
    <Modal open onClose={onClose} title={dish.name} size="md" testId="dish-description-modal">
      <div className="flex flex-col gap-4">
        {languages.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('dishes.descriptionLanguage')}>
            {languages.map((code) => (
              <Button
                key={code}
                size="sm"
                variant="primary"
                filled={code === lang}
                flat={code !== lang}
                active={code === lang}
                data-testid={`dish-description-lang-${code}`}
                onClick={() => setLang(code)}
              >
                {languageLabel(code)}
              </Button>
            ))}
          </div>
        )}

        {text ? (
          <p
            className="text-lg leading-relaxed text-neutral-800 whitespace-pre-line"
            lang={lang}
            data-testid="dish-description-text"
          >
            {text}
          </p>
        ) : (
          <p className="text-neutral-500" data-testid="dish-description-empty">
            {t('dishes.noDescription')}
          </p>
        )}

        <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
          <span className="text-xl font-bold tabular-nums">{withCurrency(price)}</span>
          <Button variant="primary" onClick={onClose}>
            {t('common:actions.close')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
