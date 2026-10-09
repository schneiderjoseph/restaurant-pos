import { MenuItem, MenuItemType } from '@/api/model/cart_item.ts';
import { Category } from '@/api/model/category.ts';
import { recordIdToString } from '@/api/reports/shared/records.ts';
import { safeNumber } from '@/lib/utils.ts';

/**
 * Service hours on a category (breakfast 06:00–10:00), set in Manage > Categories.
 *
 * On a category flagged `room_included`, during its hours a hotel guest (in a room) gets its
 * dishes at 0, the line showing "Included (room)". Anyone else (walk-in), and everybody outside
 * the hours, pays the walk-in price (`walkin_price`, 1 690 as ASI's "PETIT DEJEUNER") on each
 * plate, i.e. each dish whose own price is 0. The base dishes (`package_base_items`, coffee +
 * fruits) come with the plate and stay at 0; a dish with its own price (> 0) keeps it.
 */

const HHMM = /^(\d{1,2}):(\d{2})$/;

/** "06:30" → 390; anything else → null. */
export const parseHhmm = (value?: string | null): number | null => {
  const match = HHMM.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
};

type HoursFields = Pick<Category, 'available_from' | 'available_to'>;

/** True when the category has hours (both ends set). */
export const hasCategoryHours = (category?: HoursFields | null): boolean =>
  parseHhmm(category?.available_from) != null && parseHhmm(category?.available_to) != null;

/**
 * Inside the category hours at `minutes` past midnight. No hours = always. The end is excluded
 * (06:00–10:00 closes at 10:00 sharp); an end before the start runs past midnight (22:00–02:00).
 */
export const isWithinCategoryHours = (category: HoursFields | null | undefined, minutes: number): boolean => {
  const from = parseHhmm(category?.available_from);
  const to = parseHhmm(category?.available_to);
  if (from == null || to == null || from === to) {
    return true;
  }
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
};

/** "06:00–10:00", or '' without hours. */
export const formatCategoryHours = (category?: HoursFields | null): string =>
  hasCategoryHours(category) ? `${category?.available_from}–${category?.available_to}` : '';

export interface CategoryPricingContext {
  categories: Category[];
  /** The order's guest is in a hotel room (`isRoomGuest`). */
  roomGuest: boolean;
  /** Minutes past midnight, in the restaurant's time zone. */
  minutes: number;
  /** "Included (room)", shown after the dish name on a free line. */
  roomIncludedLabel: string;
}

const lineCategoryId = (line: MenuItem): string =>
  recordIdToString(line.category_id) || recordIdToString(line.dish?.categories?.[0]?.id);

/** The variant without the room label, or undefined when nothing else is left. */
const stripLabel = (variant: string | undefined, label: string): string | undefined => {
  const rest = String(variant ?? '')
    .split(' · ')
    .filter((part) => part.trim() !== '' && part !== label)
    .join(' · ');
  return rest === '' ? undefined : rest;
};

const withLabel = (variant: string | undefined, label: string): string =>
  [stripLabel(variant, label), label].filter(Boolean).join(' · ');

/**
 * The cart as the category hours want it: free lines for a room guest, the walk-in price on the
 * plates for anyone else. Returns `cart` itself when nothing changes, so it can run on every
 * cart or guest change without looping. Only pending lines change: sent lines keep their price.
 */
export const applyCategoryHours = (cart: MenuItem[], context: CategoryPricingContext): MenuItem[] => {
  const managed = new Map(
    context.categories
      .filter((category) => category.room_included === true)
      .map((category) => [recordIdToString(category.id), category]),
  );
  if (managed.size === 0) {
    return cart;
  }

  let changed = false;
  const next = cart.map((line) => {
    const category = managed.get(lineCategoryId(line));
    if (!category || line.deleted_at || line.newOrOld !== MenuItemType.new) {
      return line;
    }

    // The price the line was added with, before these rules touched it.
    const ownPrice = safeNumber(line.hoursOwnPrice ?? line.price ?? line.dish?.price ?? 0);
    const baseIds = new Set((category.package_base_items ?? []).map((id) => recordIdToString(id)));
    const free = context.roomGuest && isWithinCategoryHours(category, context.minutes);
    const walkinPrice = safeNumber(category.walkin_price ?? 0);

    let price = ownPrice;
    if (free) {
      price = 0;
    } else if (ownPrice === 0 && walkinPrice > 0 && !baseIds.has(recordIdToString(line.dish?.id))) {
      price = walkinPrice;
    }
    const variant = free
      ? withLabel(line.variant, context.roomIncludedLabel)
      : stripLabel(line.variant, context.roomIncludedLabel);

    if (
      safeNumber(line.price) === price
      && (line.variant ?? undefined) === variant
      && line.hoursOwnPrice === ownPrice
      && (line.roomIncluded === true) === free
    ) {
      return line;
    }
    changed = true;
    const updated: MenuItem = {...line, price, variant, hoursOwnPrice: ownPrice, roomIncluded: free};
    if (!variant) {
      delete updated.variant;
    }
    return updated;
  });

  return changed ? next : cart;
};
