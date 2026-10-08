import { describe, expect, it } from 'vitest';
import {
  cleanDishVariants,
  dishSellingPayload,
  dishSellingMode,
  isValidMeasure,
  lineDisplayName,
  measureLabel,
  measurePrice,
  measureStep,
} from '@/lib/dish-selling.ts';
import { cartItemMergeKey } from '@/lib/cart.ts';
import { MenuItem, MenuItemType } from '@/api/model/cart_item.ts';

describe('dishSellingMode', () => {
  it('is single without variants or unit', () => {
    expect(dishSellingMode({})).toBe('single');
    expect(dishSellingMode({ variants: [], measure_unit: '  ' })).toBe('single');
  });

  it('is variants when one has a name and a price', () => {
    expect(dishSellingMode({ variants: [{ name: 'Shot', price: 250 }] })).toBe('variants');
    expect(dishSellingMode({ variants: [{ name: '', price: 250 }] })).toBe('single');
  });

  it('is measure when a unit is set, before variants', () => {
    expect(dishSellingMode({ measure_unit: 'once', variants: [{ name: 'Shot', price: 250 }] })).toBe('measure');
  });
});

describe('measures', () => {
  it('defaults to half units', () => {
    expect(measureStep({})).toBe(0.5);
    expect(measureStep({ measure_step: 0 })).toBe(0.5);
    expect(measureStep({ measure_step: 1 })).toBe(1);
  });

  it('accepts multiples of the step only', () => {
    expect(isValidMeasure(3.5, 0.5)).toBe(true);
    expect(isValidMeasure(0.3, 0.1)).toBe(true);
    expect(isValidMeasure(3.25, 0.5)).toBe(false);
    expect(isValidMeasure(1.5, 1)).toBe(false);
    expect(isValidMeasure(0, 0.5)).toBe(false);
  });

  it('prices quantity × unit price', () => {
    expect(measurePrice(3.5, 225)).toBe(787.5);
    expect(measurePrice(0.5, 225)).toBe(112.5);
  });

  it('labels the line', () => {
    expect(measureLabel(3.5, ' once ', 'fr')).toBe('3,5 once');
    expect(measureLabel(2, 'oz', 'en')).toBe('2 oz');
    expect(lineDisplayName('Poisson', '3,5 once')).toBe('Poisson — 3,5 once');
    expect(lineDisplayName('Poisson', null)).toBe('Poisson');
  });
});

describe('dish form payload', () => {
  it('keeps only the settings of the chosen mode', () => {
    expect(dishSellingPayload({
      mode: 'variants',
      variants: [{ name: ' Bouteille ', price: '3500' }, { name: 'Shot', price: '250' }, { name: '', price: '' }],
      measure_unit: 'once',
      measure_step: '0.5',
    })).toEqual({
      variants: [{ name: 'Bouteille', price: 3500 }, { name: 'Shot', price: 250 }],
      measure_unit: null,
      measure_step: null,
    });

    expect(dishSellingPayload({ mode: 'measure', variants: [], measure_unit: ' once ', measure_step: '0.5' }))
      .toEqual({ variants: null, measure_unit: 'once', measure_step: 0.5 });

    expect(dishSellingPayload({ mode: 'single', variants: [{ name: 'Shot', price: '250' }], measure_unit: 'once', measure_step: '1' }))
      .toEqual({ variants: null, measure_unit: null, measure_step: null });
  });

  it('drops variants without a usable price', () => {
    expect(cleanDishVariants([{ name: 'Shot', price: NaN }])).toBeNull();
  });
});

describe('cart lines', () => {
  const line = (variant?: string): MenuItem => ({
    id: 'x',
    quantity: 1,
    level: 0,
    newOrOld: MenuItemType.new,
    dish: { id: 'menu_item:rhum', name: 'Rhum', number: '1', price: 0, priority: 0 } as any,
    variant,
  });

  it('never merges two variants of the same dish', () => {
    expect(cartItemMergeKey(line('Shot'))).not.toBe(cartItemMergeKey(line('Bouteille')));
    expect(cartItemMergeKey(line('Shot'))).toBe(cartItemMergeKey(line('Shot')));
  });
});
