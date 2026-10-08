import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { faDeleteLeft, faMinus, faPlus } from '@fortawesome/free-solid-svg-icons';
import { Modal } from '@/components/common/react-aria/modal.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { Dish } from '@/api/model/dish.ts';
import { withCurrency } from '@/lib/utils.ts';
import {
  bumpMeasure,
  dishSellingMode,
  dishVariants,
  formatMeasureQuantity,
  isValidMeasure,
  measureLabel,
  measureBump,
  measureDefault,
  measurePrice,
  measureStep,
} from '@/lib/dish-selling.ts';

/** What the server picked: the label shown after the dish name and the line's unit price. */
export interface DishVariantPick {
  variant: string;
  price: number;
  measureQuantity?: number;
}

interface Props {
  dish: Dish;
  /** The dish price on the active menu: the price per unit when sold by measure. */
  unitPrice: number;
  onPick: (pick: DishVariantPick) => void;
  onClose: () => void;
}

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3'];

/** Asks which variant (bottle / shot) or how much (3.5 oz) before a dish goes in the cart. */
export const DishVariantModal = ({ dish, unitPrice, onPick, onClose }: Props) => {
  const { t, i18n } = useTranslation('menu');
  const mode = dishSellingMode(dish);

  return (
    <Modal open onClose={onClose} title={dish.name} size="md" testId="dish-variant-modal">
      {mode === 'measure' ? (
        <MeasurePicker dish={dish} unitPrice={unitPrice} locale={i18n.language} onPick={onPick} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-neutral-600">{t('variants.pickVariant')}</p>
          <div className="grid grid-cols-2 gap-3">
            {dishVariants(dish).map((variant, index) => (
              <button
                key={`${variant.name}-${index}`}
                type="button"
                className="flex min-h-[80px] flex-col justify-between gap-1 rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm select-none active:bg-warning-50 active:shadow-none"
                data-testid="dish-variant-option"
                data-variant-name={variant.name}
                onClick={() => onPick({ variant: variant.name, price: Number(variant.price) })}
              >
                <span className="text-lg font-semibold leading-snug text-neutral-900">{variant.name}</span>
                <span className="font-bold tabular-nums text-neutral-600">{withCurrency(Number(variant.price))}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
};

const MeasurePicker = ({
  dish,
  unitPrice,
  locale,
  onPick,
}: {
  dish: Dish;
  unitPrice: number;
  locale: string;
  onPick: (pick: DishVariantPick) => void;
}) => {
  const { t } = useTranslation('menu');
  const unit = String(dish.measure_unit ?? '').trim();
  const step = measureStep(dish);
  const decimals = !Number.isInteger(step);
  const bump = measureBump(dish);
  const preset = measureDefault(dish);
  // Typed text, '.' as the decimal mark. Opens on the dish's default quantity (12 oz).
  const [entry, setEntry] = useState(preset != null ? String(preset) : '');
  // The first key typed replaces the default instead of appending to it ("12" + 5 = 5, not 125).
  const [fresh, setFresh] = useState(preset != null);
  const quantity = entry === '' || entry === '.' ? 0 : Number(entry);
  const valid = isValidMeasure(quantity, step);
  const total = useMemo(() => measurePrice(quantity, unitPrice), [quantity, unitPrice]);

  const press = (key: string) => {
    const wasFresh = fresh;
    setFresh(false);
    setEntry((current) => {
      const prev = wasFresh ? '' : current;
      if (key === '.') {
        return prev.includes('.') ? prev : (prev === '' ? '0.' : `${prev}.`);
      }
      const next = prev === '0' ? key : `${prev}${key}`;
      // Two decimals at most, and no absurd lengths.
      return /^\d{0,4}(\.\d{0,2})?$/.test(next) ? next : prev;
    });
  };

  const bumpBy = (direction: 1 | -1) => {
    setFresh(false);
    setEntry(String(bumpMeasure(quantity, bump, direction)));
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-neutral-600">
        {t('variants.howMuch', { unit, price: withCurrency(unitPrice) })}
      </p>

      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          size="lg"
          iconButton
          icon={faMinus}
          aria-label={t('variants.less')}
          data-testid="dish-measure-minus"
          onClick={() => bumpBy(-1)}
        />
        <div
          className="flex-1 rounded-xl border border-neutral-300 bg-neutral-50 px-4 py-3 text-center"
          data-testid="dish-measure-display"
        >
          <span className="text-3xl font-bold tabular-nums">
            {entry === '' ? '0' : formatMeasureQuantity(quantity, locale)}
          </span>
          <span className="ml-2 text-xl text-neutral-600">{unit}</span>
        </div>
        <Button
          variant="primary"
          size="lg"
          iconButton
          icon={faPlus}
          aria-label={t('variants.more')}
          data-testid="dish-measure-plus"
          onClick={() => bumpBy(1)}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {KEYS.map((key) => (
          <Button
            key={key}
            size="xl"
            flat
            variant="primary"
            className="aspect-square !h-auto !min-h-[4.5rem] w-full text-2xl"
            data-testid={`dish-measure-key-${key}`}
            onClick={() => press(key)}
          >
            {key}
          </Button>
        ))}
        <Button
          size="xl"
          flat
          variant="primary"
          disabled={!decimals}
          className="aspect-square !h-auto !min-h-[4.5rem] w-full text-2xl"
          data-testid="dish-measure-key-dot"
          onClick={() => press('.')}
        >
          {(0.5).toLocaleString(locale).replace(/\d/g, '') || '.'}
        </Button>
        <Button
          size="xl"
          flat
          variant="primary"
          className="aspect-square !h-auto !min-h-[4.5rem] w-full text-2xl"
          data-testid="dish-measure-key-0"
          onClick={() => press('0')}
        >
          0
        </Button>
        <Button
          size="xl"
          flat
          variant="danger"
          icon={faDeleteLeft}
          className="aspect-square !h-auto !min-h-[4.5rem] w-full text-2xl"
          aria-label={t('variants.erase')}
          data-testid="dish-measure-key-back"
          onClick={() => {
            setFresh(false);
            setEntry((prev) => prev.slice(0, -1));
          }}
        />
      </div>

      {quantity > 0 && !valid && (
        <p className="text-danger-600 text-sm" data-testid="dish-measure-invalid">
          {t('variants.invalidStep', { step: formatMeasureQuantity(step, locale), unit })}
        </p>
      )}

      <div className="flex items-center justify-between border-t border-neutral-200 pt-3">
        <span className="text-xl font-bold tabular-nums" data-testid="dish-measure-total">
          {withCurrency(valid ? total : 0)}
        </span>
        <Button
          variant="primary"
          filled
          size="lg"
          disabled={!valid}
          data-testid="dish-measure-confirm"
          onClick={() =>
            onPick({
              variant: measureLabel(quantity, unit, locale),
              price: total,
              measureQuantity: quantity,
            })
          }
        >
          {t('variants.add')}
        </Button>
      </div>
    </div>
  );
};
