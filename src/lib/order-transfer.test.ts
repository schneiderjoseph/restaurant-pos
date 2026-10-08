import { beforeEach, describe, expect, it, vi } from 'vitest';

const syncOrderTaxes = vi.fn(async () => undefined);
const postOrderTracking = vi.fn();
vi.mock('@/lib/order-tax.service.ts', () => ({ syncOrderTaxes }));
vi.mock('@/lib/tracking.service.ts', () => ({ postOrderTracking }));
vi.mock('@/integrations/events/publish/entity.ts', () => ({ entityAfterWrite: async () => undefined }));

const { transferOrderToCustomer } = await import('@/lib/order-transfer.ts');

type Call = { sql: string; params?: Record<string, unknown> };

const fakeDb = (stored: Record<string, unknown> | undefined, updated: unknown[] = [{ id: 'order:o' }]) => {
  const calls: Call[] = [];
  return {
    calls,
    query: async (sql: string, params?: Record<string, unknown>) => {
      calls.push({ sql, params });
      return sql.startsWith('SELECT') ? [stored] : [updated];
    },
  } as never as Parameters<typeof transferOrderToCustomer>[0] & { calls: Call[] };
};

const trace = { module: 'Transfert' };
const target = { id: 'customer:to', name: 'Marie' };
const ids = (values: unknown) => (values as unknown[]).map(String).sort();

beforeEach(() => {
  syncOrderTaxes.mockClear();
  postOrderTracking.mockClear();
});

describe('transferOrderToCustomer', () => {
  it('moves an in-progress order and traces from → to', async () => {
    const db = fakeDb({ status: 'In Progress', customer: 'customer:from', customer_name: 'Paul', excluded_taxes: [] });
    expect(await transferOrderToCustomer(db, 'order:o', target, trace)).toBe('ok');

    const update = db.calls[1];
    expect(update.sql).toContain('WHERE status = $status AND customer = $from');
    expect(String(update.params?.from)).toBe('customer:from');
    expect(String(update.params?.to)).toBe('customer:to');
    expect(syncOrderTaxes).not.toHaveBeenCalled();
    expect(postOrderTracking).toHaveBeenCalledWith(expect.objectContaining({
      payload: { from_customer: 'customer:from', from_name: 'Paul', to_customer: 'customer:to', to_name: 'Marie' },
    }));
  });

  it('refuses the same customer and a paid order without writing', async () => {
    const same = fakeDb({ status: 'In Progress', customer: 'customer:to' });
    expect(await transferOrderToCustomer(same, 'order:o', target, trace)).toBe('same');
    const paid = fakeDb({ status: 'Paid', customer: 'customer:from' });
    expect(await transferOrderToCustomer(paid, 'order:o', target, trace)).toBe('changed');
    expect(same.calls).toHaveLength(1);
    expect(paid.calls).toHaveLength(1);
  });

  it('reports a change made meanwhile (the conditional write matched nothing)', async () => {
    const db = fakeDb({ status: 'In Progress', customer: 'customer:from' }, []);
    expect(await transferOrderToCustomer(db, 'order:o', target, trace)).toBe('changed');
    expect(postOrderTracking).not.toHaveBeenCalled();
  });

  it('gives back the old exemptions, applies the new ones, keeps manual ones, retaxes', async () => {
    const db = fakeDb({
      status: 'In Progress',
      customer: 'customer:from',
      from_exemptions: ['tax:tca'],
      excluded_taxes: ['tax:tca', 'tax:manual'],
    });
    await transferOrderToCustomer(db, 'order:o', { ...target, tax_exemptions: ['tax:service'] }, trace);
    expect(ids(db.calls[1].params?.excluded)).toEqual(['tax:manual', 'tax:service']);
    expect(syncOrderTaxes).toHaveBeenCalledOnce();
  });

  it('moves an order that had no customer', async () => {
    const db = fakeDb({ status: 'In Progress', customer: null });
    expect(await transferOrderToCustomer(db, 'order:o', target, trace)).toBe('ok');
    expect(db.calls[1].sql).toContain('(customer = NONE OR customer = NULL)');
    expect(db.calls[1].params).not.toHaveProperty('from');
  });
});
