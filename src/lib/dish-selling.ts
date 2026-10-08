import { Dish, DishVariant } from '@/api/model/dish.ts';

/**
 * How a dish is sold, set on the dish in Manage > Dishes:
 *  - 'variants': the server picks one of its variants (bottle / shot), each with its own price;
 *  - 'measure': the server enters how much (3.5 oz), price = quantity × the dish price;
 *  - 'single': one price, added straight away.
 */
export type DishSellingMode = 'single' | 'variants' | 'measure';

export const DEFAULT_MEASURE_STEP = 0.5;

export const dishVariants = (dish?: Pick<Dish, 'variants'> | null): DishVariant[] =>
  (dish?.variants ?? []).filter(
    (variant) => variant && String(variant.name ?? '').trim() !== '' && Number.isFinite(Number(variant.price)),
  );

export const dishSellingMode = (dish?: Pick<Dish, 'variants' | 'measure_unit'> | null): DishSellingMode => {
  if (String(dish?.measure_unit ?? '').trim() !== '') {
    return 'measure';
  }
  return dishVariants(dish).length > 0 ? 'variants' : 'single';
};

/** Smallest quantity the server can enter (0.5 = half ounces). Unset or invalid = 0.5. */
export const measureStep = (dish?: Pick<Dish, 'measure_step'> | null): number => {
  const step = Number(dish?.measure_step);
  return Number.isFinite(step) && step > 0 ? step : DEFAULT_MEASURE_STEP;
};

/** True when `quantity` is a positive multiple of `step` (float-safe). */
export const isValidMeasure = (quantity: number, step: number): boolean => {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return false;
  }
  const ratio = quantity / step;
  return Math.abs(ratio - Math.round(ratio)) < 1e-6;
};

export const roundMoney = (value: number): number => Math.round(value * 100) / 100;

export const measurePrice = (quantity: number, unitPrice: number): number =>
  roundMoney(quantity * Number(unitPrice || 0));

export const formatMeasureQuantity = (quantity: number, locale?: string): string =>
  quantity.toLocaleString(locale, { maximumFractionDigits: 3 });

/** "3,5 once": what the line shows next to the dish name. */
export const measureLabel = (quantity: number, unit: string, locale?: string): string =>
  `${formatMeasureQuantity(quantity, locale)} ${unit.trim()}`;

/** "Rhum Barbancourt — Shot": the dish name with the variant picked at the sale. */
export const lineDisplayName = (name?: string | null, variant?: string | null): string => {
  const base = String(name ?? '');
  const extra = String(variant ?? '').trim();
  return extra ? `${base} — ${extra}` : base;
};

/** Variants as saved on the dish: trimmed names, numeric prices, empty rows dropped. Null = none. */
export const cleanDishVariants = (variants?: Array<Partial<DishVariant>> | null): DishVariant[] | null => {
  const cleaned = (variants ?? [])
    .map((variant) => ({
      name: String(variant?.name ?? '').trim(),
      price: Number(variant?.price),
    }))
    .filter((variant) => variant.name !== '' && Number.isFinite(variant.price));
  return cleaned.length > 0 ? cleaned : null;
};

/** Form state of how a dish is sold; prices stay text while typed. */
export interface DishSellingValue {
  mode: DishSellingMode;
  variants: { name: string; price: string }[];
  measure_unit: string;
  measure_step: string;
}

export const dishSellingFormValue = (dish?: Dish | null): DishSellingValue => ({
  mode: dishSellingMode(dish),
  variants: (dish?.variants ?? []).map((variant) => ({ name: variant.name, price: String(variant.price) })),
  measure_unit: dish?.measure_unit ?? '',
  measure_step: String(dish?.measure_step ?? DEFAULT_MEASURE_STEP),
});

/** The dish fields to save: only the chosen mode keeps its settings, the others are cleared. */
export const dishSellingPayload = (value?: DishSellingValue | null) => {
  const mode = value?.mode ?? 'single';
  const step = Number(String(value?.measure_step ?? '').replace(',', '.'));
  return {
    variants: mode === 'variants'
      ? cleanDishVariants((value?.variants ?? []).map((variant) => ({
        name: variant.name,
        price: variant.price === '' ? NaN : Number(String(variant.price).replace(',', '.')),
      })))
      : null,
    measure_unit: mode === 'measure' ? (value?.measure_unit ?? '').trim() || null : null,
    measure_step: mode === 'measure' && Number.isFinite(step) && step > 0 ? step : null,
  };
};

/** Why the settings can't be saved, or null. */
export const dishSellingError = (value: DishSellingValue | undefined, t: (key: string) => string): string | null => {
  if (!value || value.mode === 'single') {
    return null;
  }
  const payload = dishSellingPayload(value);
  if (value.mode === 'variants' && (payload.variants?.length ?? 0) < 1) {
    return t('forms.sellingVariantsRequired');
  }
  if (value.mode === 'measure' && (!payload.measure_unit || payload.measure_step == null)) {
    return t('forms.sellingMeasureRequired');
  }
  return null;
};
