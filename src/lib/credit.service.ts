import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { Order } from '@/api/model/order.ts';
import { OrderStatus } from '@/api/model/order.ts';
import type { User } from '@/api/model/user.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';
import { customerHistoryIds } from '@/lib/customer.service.ts';
import { isCreditPaymentType } from '@/lib/credit-charge.ts';
import { generateNextInvoiceNumber, getNextAutoId } from '@/lib/invoice.ts';
import { getOrderSettlementFigures } from '@/lib/order.ts';
import { isRoomPaymentType } from '@/lib/room-charge.ts';
import { toRecordId } from '@/lib/utils.ts';

const MONEY_EPS = 0.009;
const QUIET = { quiet: true } as const;

/** Order tag of a credit settlement: Paid order, no items, one cash/card line. */
export const CREDIT_SETTLEMENT_TAG = 'credit-settlement';

type AnyDb = {
  query: (sql: string, params?: Record<string, unknown>, options?: { quiet?: boolean }) => Promise<unknown>;
};

const rowsOf = <T>(result: unknown): T[] => {
  const first = Array.isArray(result) ? result[0] : undefined;
  return Array.isArray(first) ? (first as T[]) : [];
};

const idOf = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && 'id' in value) {
    return idOf((value as { id: unknown }).id);
  }
  return String(value);
};

const userRef = (user?: Pick<User, 'id'> | null) => (user?.id ? toRecordId(user.id) : null);

export class CreditServiceError extends Error {
  constructor(
    readonly code: 'nothing_to_settle' | 'invalid_settle' | 'not_found' | 'bad_tender',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CreditServiceError';
  }
}

export function customerCreditOutstanding(charged: number, settled?: number | null): number {
  const due = Math.max(0, Number(charged) || 0);
  const paid = Math.max(0, Number(settled) || 0);
  return Math.max(0, Math.round((due - paid) * 100) / 100);
}

export function isCustomerCreditSettled(charged: number, settled?: number | null): boolean {
  return customerCreditOutstanding(charged, settled) <= MONEY_EPS;
}

/** True when the order has at least one Credit tender line. */
export function orderHasCreditCharge(order: Pick<Order, 'payments'>): boolean {
  return (order.payments ?? []).some(
    (payment) => payment != null && isCreditPaymentType(payment.payment_type),
  );
}

/**
 * Credit tender total that still counts toward house AR for this order.
 * After a partial refund, payment rows still hold the original Credit amount — cap at
 * remaining goods (non-refunded lines + synced taxes). Ordinary (non-refunded) orders
 * use the Credit tender sum as-is so a lean fetch without line prices cannot under-count AR.
 */
export function orderCreditChargeTotal(
  order: Pick<Order, 'payments' | 'items' | 'tags' | 'status' | 'coupon' | 'service_charge_amount' | 'tip_amount' | 'tax_amount' | 'order_taxes' | 'order_discounts' | 'extras'>,
): number {
  const creditSum = Math.round(
    (order.payments ?? [])
      .filter((payment) => payment != null && isCreditPaymentType(payment.payment_type))
      .reduce((sum, payment) => sum + (Number(payment?.amount) || 0), 0) * 100,
  ) / 100;
  if (creditSum <= MONEY_EPS) return 0;

  const tags = Array.isArray(order.tags) ? order.tags.map(String) : [];
  const taggedRefunded = tags.some(
    (tag) => tag.toLowerCase() === String(OrderStatus.Refunded).toLowerCase(),
  );
  if (!taggedRefunded) return creditSum;

  const remaining = Math.max(0, getOrderSettlementFigures(order as Order).grandTotalDue);
  return Math.min(creditSum, Math.round(remaining * 100) / 100);
}

const CREDIT_FOLIO_FETCHES = [
  'items',
  'items.item',
  'payments',
  'payments.payment_type',
  'extras',
  'extras.order_extras',
  'order_discounts',
  'order_discounts.discount',
  'coupon',
  'coupon.coupon',
  'tax',
  'order_taxes',
  'order_taxes.tax',
].join(', ');

/**
 * Whether this Paid Credit order still counts toward house AR.
 * Full refunds keep status Paid and add a Refunded tag; partial refunds also get that tag
 * while active lines remain — only drop the order when nothing active is left.
 */
export function orderCountsTowardCreditBalance(
  order: Pick<Order, 'status' | 'tags' | 'payments' | 'items'>,
): boolean {
  if (order.status === OrderStatus.Refunded || order.status === OrderStatus.Cancelled) {
    return false;
  }
  if (order.status !== OrderStatus.Paid) return false;
  if (!orderHasCreditCharge(order)) return false;

  const tags = Array.isArray(order.tags) ? order.tags.map(String) : [];
  const taggedRefunded = tags.some(
    (tag) => tag.toLowerCase() === String(OrderStatus.Refunded).toLowerCase(),
  );
  if (!taggedRefunded) return true;

  const items = Array.isArray(order.items) ? order.items : [];
  const activeLeft = items.some(
    (item) => item != null
      && (item as { deleted_at?: unknown }).deleted_at == null
      && (item as { is_refunded?: boolean }).is_refunded !== true
      && (item as { is_suspended?: boolean }).is_suspended !== true,
  );
  // Partial refund: tag present but lines remain → keep Credit AR.
  // Full refund: tag present and no active lines → drop from AR.
  return activeLeft;
}

/**
 * Paid orders that put Credit charges on this customer (incl. merged duplicates).
 * Settlement orders (cash/card) are excluded by having no Credit tender.
 * Fully refunded orders (tag Refunded, status still Paid) are excluded.
 */
export async function loadCustomerCreditFolioOrders(
  db: AnyDb,
  customerId: unknown,
): Promise<Order[]> {
  if (customerId == null || customerId === '') return [];
  const customers = await customerHistoryIds(db, customerId);
  if (customers.length === 0) return [];

  const orders = rowsOf<Order>(
    await db.query(
      `SELECT * FROM ${Tables.orders}
       WHERE customer IN $customers
         AND deleted_at = none
         AND status = $paid
       ORDER BY created_at ASC
       FETCH ${CREDIT_FOLIO_FETCHES}`,
      {
        customers,
        paid: OrderStatus.Paid,
      },
    ),
  );
  return orders.filter(orderCountsTowardCreditBalance);
}

/** Sum of Credit charges across guest folio orders. */
export function customerCreditFolioTotal(orders: Order[]): number {
  return Math.round(
    orders.reduce((sum, order) => sum + orderCreditChargeTotal(order), 0) * 100,
  ) / 100;
}

/** Sum of Credit tender amounts on Paid orders for this customer history. */
export async function loadCustomerCreditTotal(db: AnyDb, customerId: unknown): Promise<number> {
  const orders = await loadCustomerCreditFolioOrders(db, customerId);
  return customerCreditFolioTotal(orders);
}

/** Amount already collected on the house account. */
export async function loadCustomerCreditSettledTotal(
  db: AnyDb,
  customerId: unknown,
): Promise<number> {
  if (customerId == null || customerId === '') return 0;
  const customers = await customerHistoryIds(db, customerId);
  if (customers.length === 0) return 0;
  const rows = rowsOf<number>(
    await db.query(
      `SELECT VALUE amount FROM ${Tables.customer_credit_settlements}
       WHERE customer IN $customers`,
      { customers },
    ),
  );
  return Math.round(rows.reduce((sum, amount) => sum + (Number(amount) || 0), 0) * 100) / 100;
}

export async function loadCustomerCreditOutstanding(
  db: AnyDb,
  customerId: unknown,
): Promise<number> {
  const [charged, settled] = await Promise.all([
    loadCustomerCreditTotal(db, customerId),
    loadCustomerCreditSettledTotal(db, customerId),
  ]);
  return customerCreditOutstanding(charged, settled);
}

export type CreditSettlementRow = {
  id?: unknown;
  amount?: number;
  comments?: string;
  created_at?: unknown;
  payment_type?: { name?: string; type?: string };
};

export async function loadCustomerCreditSettlements(
  db: AnyDb,
  customerId: unknown,
): Promise<CreditSettlementRow[]> {
  if (customerId == null || customerId === '') return [];
  const customers = await customerHistoryIds(db, customerId);
  if (customers.length === 0) return [];
  return rowsOf<CreditSettlementRow>(
    await db.query(
      `SELECT id, amount, comments, created_at, payment_type FROM ${Tables.customer_credit_settlements}
       WHERE customer IN $customers
       ORDER BY created_at ASC
       FETCH payment_type`,
      { customers },
    ),
  );
}

/** Customers with house credit enabled (for Front Desk credit panel). */
export async function listCreditCustomers(db: AnyDb): Promise<Customer[]> {
  return rowsOf<Customer>(
    await db.query(
      `SELECT * FROM ${Tables.customers}
       WHERE ${ACTIVE_CUSTOMER}
         AND credit_allowed = true
       ORDER BY name ASC
       LIMIT 500`,
    ),
  );
}

export interface SettleCustomerCreditInput {
  customerId: unknown;
  /** Cash or Card (never Credit / Room) payment type record id. */
  paymentTypeId: unknown;
  /** Amount to collect now; defaults to outstanding. */
  amount?: number;
  comments?: string;
  user?: Pick<User, 'id'> | null;
  /** Optional payment type row for client-side tender validation before the TX. */
  paymentType?: { type?: string } | null;
}

/**
 * Cashier collects cash/card against the house-account balance (payments.receive).
 * Money is a Paid order tagged credit-settlement; closing/cash reports count it.
 */
export async function settleCustomerCredit(
  db: AnyDb,
  input: SettleCustomerCreditInput,
): Promise<{ outstanding: number; settledAmount: number }> {
  if (input.customerId == null || input.customerId === '') {
    throw new CreditServiceError('not_found', 'Customer required');
  }
  if (input.paymentTypeId == null || input.paymentTypeId === '') {
    throw new CreditServiceError('invalid_settle', 'Payment type required');
  }
  if (
    isCreditPaymentType(input.paymentType)
    || isRoomPaymentType(input.paymentType)
  ) {
    throw new CreditServiceError('bad_tender', 'Settle with cash or card only');
  }

  const customerId = toRecordId(idOf(input.customerId));
  const [total, settled] = await Promise.all([
    loadCustomerCreditTotal(db, customerId),
    loadCustomerCreditSettledTotal(db, customerId),
  ]);
  const outstanding = customerCreditOutstanding(total, settled);
  if (outstanding <= MONEY_EPS) {
    throw new CreditServiceError('nothing_to_settle', 'Credit account already settled');
  }

  const amount = input.amount == null ? outstanding : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= MONEY_EPS) {
    throw new CreditServiceError('invalid_settle', 'Settle amount must be positive');
  }
  if (amount > outstanding + MONEY_EPS) {
    throw new CreditServiceError('invalid_settle', 'Settle amount exceeds outstanding credit');
  }
  const rounded = Math.round(amount * 100) / 100;
  const counters = db as Parameters<typeof generateNextInvoiceNumber>[0];
  const [invoiceNumber, autoId] = [await generateNextInvoiceNumber(counters), await getNextAutoId(counters)];

  try {
    await db.query(
      `BEGIN TRANSACTION;
       LET $customer = (SELECT * FROM ONLY $id);
       IF $customer = NONE { THROW 'not_found' };
       LET $customers = array::concat([$id], (SELECT VALUE id FROM customer WHERE merged_into = $id));
       LET $before = math::sum((SELECT VALUE amount FROM ${Tables.customer_credit_settlements} WHERE customer IN $customers));
       IF $amount > $total - $before + ${MONEY_EPS} { THROW 'invalid_settle' };
       LET $type = (SELECT id, priority FROM order_type WHERE deleted_at = NONE ORDER BY priority LIMIT 1)[0].id;
       IF $type = NONE { THROW 'no_order_type' };
       LET $pt = (SELECT id, type FROM ONLY $payment_type);
       IF $pt = NONE { THROW 'invalid_settle' };
       IF string::lowercase($pt.type ?? '') = 'credit' OR string::lowercase($pt.type ?? '') = 'room' {
         THROW 'bad_tender'
       };
       LET $payment = (CREATE ONLY ${Tables.order_payment} SET
         amount = $amount,
         payable = $amount,
         payment_type = $payment_type,
         comments = $comments);
       LET $order = (CREATE ONLY ${Tables.orders} SET
         status = '${OrderStatus.Paid}',
         items = [],
         payments = [$payment.id],
         order_type = $type,
         customer = $id,
         user = $user,
         cashier = $user,
         invoice_number = $invoice_number,
         auto_id = $auto_id,
         created_at = time::now(),
         completed_at = time::now(),
         tags = ['${CREDIT_SETTLEMENT_TAG}'],
         notes = $notes);
       CREATE ${Tables.customer_credit_settlements} SET
         customer = $id,
         order = $order.id,
         amount = $amount,
         payment_type = $payment_type,
         created_by = $user,
         created_at = time::now(),
         comments = $comments;
       COMMIT TRANSACTION;`,
      {
        id: customerId,
        amount: rounded,
        total,
        payment_type: toRecordId(idOf(input.paymentTypeId)),
        user: userRef(input.user),
        comments: input.comments?.trim() || 'Credit account settlement',
        notes: 'Règlement crédit',
        invoice_number: invoiceNumber,
        auto_id: autoId,
      },
      QUIET,
    );
  } catch (error) {
    const message = String((error as { message?: string })?.message ?? error ?? '');
    if (message.includes('nothing_to_settle') || message.includes('invalid_settle')) {
      throw new CreditServiceError(
        message.includes('nothing_to_settle') ? 'nothing_to_settle' : 'invalid_settle',
      );
    }
    if (message.includes('bad_tender')) {
      throw new CreditServiceError('bad_tender');
    }
    if (message.includes('not_found')) {
      throw new CreditServiceError('not_found');
    }
    throw error;
  }

  return {
    settledAmount: rounded,
    outstanding: customerCreditOutstanding(total, settled + rounded),
  };
}
