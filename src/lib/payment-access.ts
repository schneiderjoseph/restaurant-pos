import { RecordId, StringRecordId } from 'surrealdb';

/** Role permission: this user may take a payment (add a tender, complete the order). */
export const RECEIVE_PAYMENT_MODULE = 'payments.receive';

type WithId = { id?: unknown };

const idOf = (value: unknown): string => {
  if (value == null) return '';
  if (value instanceof RecordId || value instanceof StringRecordId || typeof value !== 'object') {
    return String(value);
  }
  // A fetched record ({ id, name, … }).
  return 'id' in value ? idOf((value as WithId).id) : '';
};

/** Ids of the payment types a role is limited to; empty when the role accepts every type. */
export const rolePaymentTypeIds = (allowed: readonly unknown[] | null | undefined): string[] =>
  (allowed ?? []).map(idOf).filter(Boolean);

/**
 * Payment types a role may take. A role with no list (or an empty one) accepts every type,
 * so roles saved before the list existed keep working.
 */
export const filterPaymentTypesForRole = <T extends WithId>(
  types: readonly T[] | null | undefined,
  allowed: readonly unknown[] | null | undefined,
): T[] => {
  const list = [...(types ?? [])];
  const ids = new Set(rolePaymentTypeIds(allowed));
  if (ids.size === 0) return list;
  return list.filter((type) => ids.has(idOf(type.id)));
};
