import { Tables } from '@/api/db/tables.ts';
import {
  CustomerCreditRequest,
  CustomerCreditRequestStatus,
} from '@/api/model/customer_credit_request.ts';
import { recordKey } from '@/lib/kitchen/routing.ts';
import { toRecordId } from '@/lib/utils.ts';

/** `table:id` whether fetched (`{ id }`) or a bare record id. */
const refKey = (value: unknown): string => {
  const key = recordKey(value);
  return key && key !== '[object Object]' ? key : recordKey((value as { id?: unknown })?.id);
};

/** Role permission: receive and decide house-credit open requests. */
export const APPROVE_CREDIT_MODULE = 'credit.approve';

/** Browser event: a credit request for this customer was decided (payment screen refreshes). */
export const CREDIT_REQUEST_DECIDED_EVENT = 'posr:credit-request-decided';

export type CreditRequestDecision = 'approved' | 'rejected' | 'expired' | 'taken' | 'already_pending';

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>) => Promise<any>;
};

export class CreditRequestError extends Error {
  constructor(
    message: string,
    readonly code: 'no_customer' | 'already_pending' | 'create_failed',
  ) {
    super(message);
    this.name = 'CreditRequestError';
  }
}

export function dispatchCreditRequestDecided(customerId: unknown): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(CREDIT_REQUEST_DECIDED_EVENT, {
      detail: { customerId: refKey(customerId) },
    }),
  );
}

/** Pending request for this customer, if any. */
export async function findPendingCreditRequest(
  db: AnyDb,
  customerId: unknown,
): Promise<CustomerCreditRequest | null> {
  if (customerId == null || customerId === '') return null;
  const [rows] = await db.query(
    `SELECT * FROM ${Tables.customer_credit_requests}
     WHERE customer = $customer AND status = $pending
     ORDER BY created_at DESC
     LIMIT 1
     FETCH customer, requested_by, order`,
    {
      customer: toRecordId(customerId),
      pending: CustomerCreditRequestStatus.pending,
    },
  );
  const list = Array.isArray(rows) ? rows : [];
  return (list[0] as CustomerCreditRequest | undefined) ?? null;
}

export async function createCreditRequest(
  db: AnyDb,
  args: { customerId: unknown; requestedBy: unknown; orderId?: unknown },
): Promise<CustomerCreditRequest> {
  if (args.customerId == null || args.customerId === '') {
    throw new CreditRequestError('Customer required', 'no_customer');
  }

  const existing = await findPendingCreditRequest(db, args.customerId);
  if (existing) {
    throw new CreditRequestError('Already pending', 'already_pending');
  }

  const [created] = await db.query(
    `CREATE ${Tables.customer_credit_requests} CONTENT {
       customer: $customer,
       order: $order,
       requested_by: $requestedBy,
       status: $status,
       created_at: time::now()
     } RETURN AFTER`,
    {
      customer: toRecordId(args.customerId),
      order: args.orderId != null && args.orderId !== '' ? toRecordId(args.orderId) : null,
      requestedBy: toRecordId(args.requestedBy),
      status: CustomerCreditRequestStatus.pending,
    },
  );
  const row = Array.isArray(created) ? created[0] : created;
  if (!row?.id) {
    throw new CreditRequestError('Create failed', 'create_failed');
  }
  return row as CustomerCreditRequest;
}

export async function fetchPendingCreditRequests(db: AnyDb): Promise<CustomerCreditRequest[]> {
  const [rows] = await db.query(
    `SELECT * FROM ${Tables.customer_credit_requests}
     WHERE status = $status
     ORDER BY created_at ASC
     FETCH customer, order, order.table, requested_by`,
    { status: CustomerCreditRequestStatus.pending },
  );
  return Array.isArray(rows) ? (rows as CustomerCreditRequest[]) : [];
}

const claimRequest = async (
  db: AnyDb,
  requestId: unknown,
  status: CustomerCreditRequestStatus,
  decidedBy: unknown,
  approvedLimit?: number | null,
): Promise<boolean> => {
  const [rows] = await db.query(
    `UPDATE ${toRecordId(refKey(requestId))}
     SET status = $status,
         decided_by = $decidedBy,
         decided_at = time::now(),
         approved_limit = $approvedLimit
     WHERE status = $pending
     RETURN AFTER`,
    {
      status,
      decidedBy: toRecordId(decidedBy),
      pending: CustomerCreditRequestStatus.pending,
      approvedLimit: approvedLimit === undefined ? null : approvedLimit,
    },
  );
  return Array.isArray(rows) && rows.length > 0;
};

export const rejectCreditRequest = async (
  db: AnyDb,
  request: Pick<CustomerCreditRequest, 'id'>,
  decidedBy: unknown,
): Promise<CreditRequestDecision> =>
  (await claimRequest(db, request.id, CustomerCreditRequestStatus.rejected, decidedBy))
    ? 'rejected'
    : 'taken';

/**
 * Opens house credit on the customer. `approvedLimit` null/undefined = no ceiling.
 * Empty string from the form should be passed as null.
 */
export const approveCreditRequest = async (
  db: AnyDb,
  request: Pick<CustomerCreditRequest, 'id' | 'customer'>,
  decidedBy: unknown,
  approvedLimit?: number | null,
): Promise<CreditRequestDecision> => {
  const customerId = refKey(request.customer);
  if (!customerId) {
    const expired = await claimRequest(
      db,
      request.id,
      CustomerCreditRequestStatus.expired,
      decidedBy,
    );
    return expired ? 'expired' : 'taken';
  }

  const [customers] = await db.query(
    `SELECT id, deleted_at, merged_into FROM ${toRecordId(customerId)}`,
  );
  const customer = customers?.[0];
  if (!customer || customer.deleted_at != null || customer.merged_into != null) {
    const expired = await claimRequest(
      db,
      request.id,
      CustomerCreditRequestStatus.expired,
      decidedBy,
    );
    return expired ? 'expired' : 'taken';
  }

  const limit =
    approvedLimit != null && Number.isFinite(Number(approvedLimit)) && Number(approvedLimit) > 0
      ? Math.round(Number(approvedLimit) * 100) / 100
      : null;

  if (!(await claimRequest(db, request.id, CustomerCreditRequestStatus.approved, decidedBy, limit))) {
    return 'taken';
  }

  try {
    await db.query(
      `UPDATE ${toRecordId(customerId)} SET
         credit_allowed = true,
         credit_limit = $limit,
         updated_at = time::now(),
         updated_by = $decidedBy`,
      {
        limit,
        decidedBy: toRecordId(decidedBy),
      },
    );
    return 'approved';
  } catch (error) {
    await db
      .query(
        `UPDATE ${toRecordId(refKey(request.id))}
         SET status = $pending, decided_by = NONE, decided_at = NONE, approved_limit = NONE`,
        { pending: CustomerCreditRequestStatus.pending },
      )
      .catch(() => undefined);
    throw error;
  }
};
