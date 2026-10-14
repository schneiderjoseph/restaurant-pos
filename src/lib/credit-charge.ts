import type { Customer } from '@/api/model/customer.ts';
import type { PaymentType } from '@/api/model/payment_type.ts';
import { toRecordId } from '@/lib/utils.ts';
import { RecordId, StringRecordId } from 'surrealdb';

/** `payment_type.type` of the house-account (buy now, settle later) tender. */
export const CREDIT_PAYMENT_TYPE = 'Credit';

const MONEY_EPS = 0.009;

export type CreditChargeRefusal =
  | 'no-customer'
  | 'not-allowed'
  | 'over-limit'
  | 'deleted';

/** One shape (no union narrowing): project compiles without strictNullChecks. */
export type CreditChargeCheck = {
  ok: boolean;
  reason?: CreditChargeRefusal;
  /** Remaining room under the limit after this charge (unset when unlimited or refused). */
  headroom?: number;
};

export function isCreditPaymentType(paymentType?: { type?: PaymentType['type'] } | null): boolean {
  return String(paymentType?.type ?? '').toLowerCase() === CREDIT_PAYMENT_TYPE.toLowerCase();
}

/**
 * Whether this amount may be put on the customer's house account.
 * `outstandingBefore` is the balance already due (DB + other Credit lines on this ticket).
 */
export function checkCreditCharge(
  customer: Pick<Customer, 'credit_allowed' | 'credit_limit' | 'deleted_at'> | null | undefined,
  chargeAmount: number,
  outstandingBefore = 0,
): CreditChargeCheck {
  if (!customer) {
    return { ok: false, reason: 'no-customer' };
  }
  if (customer.deleted_at != null && customer.deleted_at !== '') {
    return { ok: false, reason: 'deleted' };
  }
  if (customer.credit_allowed !== true) {
    return { ok: false, reason: 'not-allowed' };
  }

  const amount = Number(chargeAmount);
  if (!Number.isFinite(amount) || amount <= MONEY_EPS) {
    return { ok: false, reason: 'not-allowed' };
  }

  const before = Math.max(0, Number(outstandingBefore) || 0);
  const after = Math.round((before + amount) * 100) / 100;
  const limit = customer.credit_limit;
  if (limit != null && Number.isFinite(Number(limit))) {
    const ceiling = Math.max(0, Number(limit));
    if (after > ceiling + MONEY_EPS) {
      return { ok: false, reason: 'over-limit' };
    }
    return {
      ok: true,
      headroom: Math.round((ceiling - after) * 100) / 100,
    };
  }

  return { ok: true };
}

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
};

/** Order's customer as stored right now — never the copy held by the screen. */
export async function loadCustomerForCreditCharge(
  db: AnyDb,
  customer: unknown,
): Promise<Customer | undefined> {
  const isReference =
    typeof customer === 'string'
    || customer instanceof RecordId
    || customer instanceof StringRecordId;
  const id = isReference ? customer : (customer as { id?: unknown } | null | undefined)?.id;
  if (id == null || id === '') {
    return undefined;
  }
  const result = await db.query('SELECT * FROM $id', { id: toRecordId(id) });
  const rows = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(rows) ? (rows[0] as Customer | undefined) : undefined;
}
