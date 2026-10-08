import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Input } from '@/components/common/input/input.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { DishSellingMode, DishSellingValue, dishSellingFormValue } from '@/lib/dish-selling.ts';

interface Props {
  value?: DishSellingValue;
  onChange: (value: DishSellingValue) => void;
  error?: string | null;
}

const MODES: DishSellingMode[] = ['single', 'variants', 'measure'];

/** Manage > Dishes: one price, several variants (bottle / shot) or sold by measure (per ounce). */
export const DishSellingFields = ({ value, onChange, error }: Props) => {
  const { t } = useTranslation('admin');
  const current = value ?? dishSellingFormValue(null);
  const set = (patch: Partial<DishSellingValue>) => onChange({ ...current, ...patch });
  const setVariant = (index: number, patch: Partial<DishSellingValue['variants'][number]>) =>
    set({ variants: current.variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)) });

  return (
    <div className="flex flex-col gap-2 mb-3 rounded-xl border border-neutral-200 p-3" data-testid="dish-selling-fields">
      <label>{t('forms.sellingMode')}</label>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('forms.sellingMode')}>
        {MODES.map((mode) => (
          <Button
            key={mode}
            variant="primary"
            filled={current.mode === mode}
            flat={current.mode !== mode}
            active={current.mode === mode}
            data-testid={`dish-selling-mode-${mode}`}
            onClick={() => set({
              mode,
              variants: mode === 'variants' && current.variants.length === 0
                ? [{ name: '', price: '' }, { name: '', price: '' }]
                : current.variants,
            })}
          >
            {t(`forms.sellingModes.${mode}`)}
          </Button>
        ))}
      </div>
      <p className="text-sm text-neutral-500">{t(`forms.sellingHints.${current.mode}`)}</p>

      {current.mode === 'variants' && (
        <div className="flex flex-col gap-2">
          {current.variants.map((variant, index) => (
            <div key={index} className="flex gap-2 items-end">
              <div className="flex-1">
                <Input
                  label={index === 0 ? t('forms.variantName') : undefined}
                  value={variant.name}
                  placeholder={t('forms.variantNamePlaceholder')}
                  data-testid={`dish-variant-name-${index}`}
                  onChange={(event) => setVariant(index, { name: (event.target as HTMLInputElement).value })}
                />
              </div>
              <div className="w-[160px]">
                <Input
                  label={index === 0 ? t('forms.variantPrice') : undefined}
                  type="number"
                  value={variant.price}
                  data-testid={`dish-variant-price-${index}`}
                  onChange={(event) => setVariant(index, { price: (event.target as HTMLInputElement).value })}
                />
              </div>
              <Button
                variant="danger"
                flat
                iconButton
                aria-label={t('forms.removeVariant')}
                data-testid={`dish-variant-remove-${index}`}
                onClick={() => set({ variants: current.variants.filter((_, i) => i !== index) })}
              >
                <FontAwesomeIcon icon={faTrash} />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="primary"
              flat
              icon={faPlus}
              data-testid="dish-variant-add"
              onClick={() => set({ variants: [...current.variants, { name: '', price: '' }] })}
            >
              {t('forms.addVariant')}
            </Button>
          </div>
        </div>
      )}

      {current.mode === 'measure' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              label={t('forms.measureUnit')}
              value={current.measure_unit}
              placeholder={t('forms.measureUnitPlaceholder')}
              data-testid="dish-measure-unit"
              onChange={(event) => set({ measure_unit: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div className="flex-1">
            <label>{t('forms.measureStep')}</label>
            <select
              className="form-control"
              value={current.measure_step}
              data-testid="dish-measure-step"
              onChange={(event) => set({ measure_step: event.target.value })}
            >
              <option value="1">{t('forms.measureSteps.whole')}</option>
              <option value="0.5">{t('forms.measureSteps.half')}</option>
              <option value="0.25">{t('forms.measureSteps.quarter')}</option>
              <option value="0.1">{t('forms.measureSteps.tenth')}</option>
            </select>
          </div>
        </div>
      )}

      {current.mode === 'measure' && (
        <div className="flex gap-3">
          <div className="flex-1">
            <Input
              label={t('forms.measureDefault')}
              type="number"
              value={current.measure_default}
              placeholder={t('forms.measureDefaultPlaceholder')}
              data-testid="dish-measure-default"
              onChange={(event) => set({ measure_default: (event.target as HTMLInputElement).value })}
            />
          </div>
          <div className="flex-1">
            <Input
              label={t('forms.measureBump')}
              type="number"
              value={current.measure_bump}
              placeholder={t('forms.measureBumpPlaceholder')}
              data-testid="dish-measure-bump"
              onChange={(event) => set({ measure_bump: (event.target as HTMLInputElement).value })}
            />
          </div>
        </div>
      )}

      {error && <p className="text-danger-600 text-sm" data-testid="dish-selling-error">{error}</p>}
    </div>
  );
};
