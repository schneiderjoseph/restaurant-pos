import type { Customer } from '@/api/model/customer.ts';
import { cleanList } from '@/lib/customer.service.ts';

/**
 * Customer preferences. Allergies are stored as the text staff read (a common allergen is
 * stored under its translated name), because kitchen tickets print them as they are.
 * Diets are stored as keys and translated on display (menu:customer.diet.<key>).
 */

/** The 14 allergens of EU labelling: one tap each in the preferences form. */
export const COMMON_ALLERGENS = [
  'peanuts', 'nuts', 'gluten', 'milk', 'eggs', 'fish', 'crustaceans',
  'molluscs', 'soy', 'sesame', 'celery', 'mustard', 'sulphites', 'lupin',
] as const;

export const DIETS = [
  'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher',
  'gluten_free', 'lactose_free', 'no_pork', 'low_salt', 'diabetic',
] as const;

export const customerAllergies = (customer?: Pick<Customer, 'allergies'> | null): string[] =>
  cleanList(customer?.allergies);

export const customerDiets = (customer?: Pick<Customer, 'dietary'> | null): string[] =>
  cleanList(customer?.dietary);

/** True on the customer's birthday (month and day of a YYYY-MM-DD, or MM-DD). */
export function isBirthdayToday(birthday?: string | null, today: Date = new Date()): boolean {
  const match = /(\d{2})-(\d{2})$/.exec(String(birthday ?? '').trim());
  if (!match) {
    return false;
  }
  return Number(match[1]) === today.getMonth() + 1 && Number(match[2]) === today.getDate();
}

/** Something staff should see before serving this customer. */
export function hasCustomerAlerts(customer?: Customer | null): boolean {
  if (!customer) return false;
  return (
    customerAllergies(customer).length > 0 ||
    customerDiets(customer).length > 0 ||
    Boolean(customer.vip) ||
    Boolean(customer.seating_pref?.trim()) ||
    Boolean(customer.notes?.trim()) ||
    isBirthdayToday(customer.birthday)
  );
}
