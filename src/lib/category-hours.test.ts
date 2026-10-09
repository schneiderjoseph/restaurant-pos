import { describe, expect, it } from 'vitest';
import { MenuItemType, type MenuItem } from '@/api/model/cart_item.ts';
import type { Category } from '@/api/model/category.ts';
import type { Dish } from '@/api/model/dish.ts';
import {
  applyCategoryHours,
  formatCategoryHours,
  isWithinCategoryHours,
  parseHhmm,
  type CategoryPricingContext,
} from '@/lib/category-hours.ts';

const LABEL = 'Inclus chambre';
const at = (hhmm: string) => parseHhmm(hhmm) as number;

const breakfast: Category = {
  id: 'category:petit_dejeuner',
  name: 'Petit-déjeuner',
  priority: 1,
  available_from: '06:00',
  available_to: '10:00',
  room_included: true,
  walkin_price: 1690,
  package_base_items: ['menu_item:m101'],
} as Category;

const coffee = { id: 'menu_item:m101', name: 'Café + fruits', number: '101', price: 0 } as Dish;
const omelette = { id: 'menu_item:m105', name: 'Omelette', number: '105', price: 0 } as Dish;
const oatmeal = { id: 'menu_item:m109', name: 'Avoine', number: '109', price: 550 } as Dish;

const line = (dish: Dish, overrides: Partial<MenuItem> = {}): MenuItem => ({
  id: `line-${dish.number}-${Math.random()}`,
  dish,
  quantity: 1,
  price: dish.price,
  level: 0,
  newOrOld: MenuItemType.new,
  selectedGroups: [],
  category: 'Petit-déjeuner',
  category_id: 'category:petit_dejeuner',
  ...overrides,
});

const ctx = (overrides: Partial<CategoryPricingContext> = {}): CategoryPricingContext => ({
  categories: [breakfast],
  roomGuest: false,
  minutes: at('07:30'),
  roomIncludedLabel: LABEL,
  ...overrides,
});

const priceOf = (cart: MenuItem[], dish: Dish) => cart.find((l) => l.dish.id === dish.id)?.price;

describe('category hours window', () => {
  it('reads HH:mm and rejects the rest', () => {
    expect(parseHhmm('06:00')).toBe(360);
    expect(parseHhmm('6:30')).toBe(390);
    expect(parseHhmm('24:00')).toBeNull();
    expect(parseHhmm('')).toBeNull();
  });

  it('opens at the start and closes at the end sharp', () => {
    expect(isWithinCategoryHours(breakfast, at('05:59'))).toBe(false);
    expect(isWithinCategoryHours(breakfast, at('06:00'))).toBe(true);
    expect(isWithinCategoryHours(breakfast, at('09:59'))).toBe(true);
    expect(isWithinCategoryHours(breakfast, at('10:00'))).toBe(false);
  });

  it('runs past midnight when the end comes before the start', () => {
    const night = { available_from: '22:00', available_to: '02:00' };
    expect(isWithinCategoryHours(night, at('23:00'))).toBe(true);
    expect(isWithinCategoryHours(night, at('01:59'))).toBe(true);
    expect(isWithinCategoryHours(night, at('12:00'))).toBe(false);
  });

  it('is always open without hours', () => {
    expect(isWithinCategoryHours({}, at('03:00'))).toBe(true);
    expect(formatCategoryHours({})).toBe('');
    expect(formatCategoryHours(breakfast)).toBe('06:00–10:00');
  });
});

describe('applyCategoryHours', () => {
  it('leaves a cart without such categories untouched', () => {
    const cart = [line(omelette)];
    expect(applyCategoryHours(cart, ctx({ categories: [{ ...breakfast, room_included: false }] }))).toBe(cart);
  });

  it('puts the walk-in price on the plate; coffee + fruits and own-priced dishes keep theirs', () => {
    const next = applyCategoryHours([line(omelette), line(coffee), line(oatmeal)], ctx());
    expect(priceOf(next, omelette)).toBe(1690);
    expect(priceOf(next, coffee)).toBe(0);
    expect(priceOf(next, oatmeal)).toBe(550);
  });

  it('is stable: a second pass changes nothing', () => {
    const once = applyCategoryHours([line(omelette)], ctx());
    expect(applyCategoryHours(once, ctx())).toBe(once);
  });

  it('makes the breakfast free for a room guest during the hours', () => {
    const next = applyCategoryHours([line(omelette), line(oatmeal)], ctx({ roomGuest: true }));
    expect(next.every((l) => l.price === 0 && l.roomIncluded && l.variant === LABEL)).toBe(true);
  });

  it('charges the walk-in price to a room guest outside the hours', () => {
    const next = applyCategoryHours([line(omelette), line(oatmeal)], ctx({ roomGuest: true, minutes: at('11:00') }));
    expect(priceOf(next, omelette)).toBe(1690);
    expect(priceOf(next, oatmeal)).toBe(550);
    expect(next.every((l) => !l.roomIncluded && l.variant === undefined)).toBe(true);
  });

  it('switches both ways when the guest changes', () => {
    const free = applyCategoryHours([line(oatmeal, { variant: 'Lait' }), line(omelette)], ctx({ roomGuest: true }));
    expect(free[0]).toMatchObject({ price: 0, variant: `Lait · ${LABEL}` });
    const paid = applyCategoryHours(free, ctx());
    expect(paid[0]).toMatchObject({ price: 550, variant: 'Lait', roomIncluded: false });
    expect(priceOf(paid, omelette)).toBe(1690);
    const freeAgain = applyCategoryHours(paid, ctx({ roomGuest: true }));
    expect(priceOf(freeAgain, omelette)).toBe(0);
  });

  it('never touches sent lines', () => {
    const sent = [line(omelette, { newOrOld: MenuItemType.old })];
    expect(applyCategoryHours(sent, ctx())).toBe(sent);
    expect(applyCategoryHours(sent, ctx({ roomGuest: true }))).toBe(sent);
  });
});
