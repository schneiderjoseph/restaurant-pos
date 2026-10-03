import { describe, expect, it } from 'vitest';
import { RecordId, StringRecordId } from 'surrealdb';
import { filterPaymentTypesForRole, RECEIVE_PAYMENT_MODULE, rolePaymentTypeIds } from '@/lib/payment-access.ts';
import { userModulesGrant } from '@/lib/access.rules.ts';

const cash = { id: new RecordId('payment_type', 'cash'), name: 'Cash' };
const card = { id: new RecordId('payment_type', 'card'), name: 'Card' };
const room = { id: new RecordId('payment_type', 'room'), name: 'Room' };
const all = [cash, card, room];

describe('filterPaymentTypesForRole', () => {
  it('accepts every type when the role has no list', () => {
    expect(filterPaymentTypesForRole(all, undefined)).toEqual(all);
    expect(filterPaymentTypesForRole(all, null)).toEqual(all);
    expect(filterPaymentTypesForRole(all, [])).toEqual(all);
  });

  it('keeps only the listed types, in the original order', () => {
    const allowed = [new RecordId('payment_type', 'room'), new RecordId('payment_type', 'cash')];
    expect(filterPaymentTypesForRole(all, allowed)).toEqual([cash, room]);
  });

  it('reads ids given as strings, string record ids or fetched records', () => {
    expect(filterPaymentTypesForRole(all, ['payment_type:card'])).toEqual([card]);
    expect(filterPaymentTypesForRole(all, [new StringRecordId('payment_type:card')])).toEqual([card]);
    expect(filterPaymentTypesForRole(all, [card])).toEqual([card]);
  });

  it('returns nothing when the listed types no longer exist', () => {
    expect(filterPaymentTypesForRole(all, ['payment_type:gone'])).toEqual([]);
  });

  it('survives a missing type list', () => {
    expect(filterPaymentTypesForRole(undefined, ['payment_type:card'])).toEqual([]);
  });
});

describe('rolePaymentTypeIds', () => {
  it('drops empty entries', () => {
    expect(rolePaymentTypeIds([null, '', 'payment_type:cash'])).toEqual(['payment_type:cash']);
  });
});

describe(RECEIVE_PAYMENT_MODULE, () => {
  it('is not granted by the orders section', () => {
    expect(userModulesGrant(['orders', 'orders.complete_payment'], RECEIVE_PAYMENT_MODULE)).toBe(false);
  });

  it('is granted by itself or its section', () => {
    expect(userModulesGrant([RECEIVE_PAYMENT_MODULE], RECEIVE_PAYMENT_MODULE)).toBe(true);
    expect(userModulesGrant(['payments'], RECEIVE_PAYMENT_MODULE)).toBe(true);
  });
});
