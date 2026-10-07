import * as yup from 'yup';
import i18n from '@/lib/i18n.ts';

/** Empty input → null; otherwise a whole number ≥ 0. */
export const optionalCountSchema = () =>
  yup.number()
    .transform((value, original) =>
      original === '' || original === null || original === undefined ? null : value
    )
    .nullable()
    .integer(i18n.t('validation:mustBeNumber'))
    .min(0, i18n.t('validation:mustBeNumber'))
    .typeError(i18n.t('validation:mustBeNumber'));

/** A positive whole number, or null when unset / 0 (the field is then left off the edge). */
export const toOptionalCount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** A maximum, when set on a group with included choices, can't be under the free or required count. */
export const isMaxModifiersValid = (
  row: { included_modifiers?: unknown; has_required_modifiers?: boolean; required_modifiers?: unknown },
  max: unknown
): boolean => {
  const maxCount = toOptionalCount(max);
  const included = toOptionalCount(row?.included_modifiers);
  if (maxCount === null || included === null) {
    return true;
  }
  const required = row?.has_required_modifiers ? (toOptionalCount(row?.required_modifiers) ?? 0) : 0;
  return maxCount >= included && maxCount >= required;
};

/**
 * SET clause and bindings for the included-choices fields of a dish ↔ group edge. Unset
 * fields are left out, so a dish that doesn't use them saves the same as before.
 */
export const includedModifiersRelateSet = (row: { included_modifiers?: unknown; max_modifiers?: unknown }) => {
  const included = toOptionalCount(row.included_modifiers);
  const max = included !== null ? toOptionalCount(row.max_modifiers) : null;
  const clauses: string[] = [];
  const bindings: Record<string, number> = {};

  if (included !== null) {
    clauses.push('included_modifiers = $included_modifiers');
    bindings.included_modifiers = included;
  }
  if (max !== null) {
    clauses.push('max_modifiers = $max_modifiers');
    bindings.max_modifiers = max;
  }

  return {
    sql: clauses.length > 0 ? `, ${clauses.join(', ')}` : '',
    bindings,
  };
};
