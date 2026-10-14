import { describe, expect, it, vi } from 'vitest';
import { CustomerCreditRequestStatus } from '@/api/model/customer_credit_request.ts';
import {
  APPROVE_CREDIT_MODULE,
  approveCreditRequest,
  createCreditRequest,
  CreditRequestError,
  findPendingCreditRequest,
  rejectCreditRequest,
} from '@/lib/credit-request.ts';

describe('APPROVE_CREDIT_MODULE', () => {
  it('is a dedicated permission id', () => {
    expect(APPROVE_CREDIT_MODULE).toBe('credit.approve');
  });
});

describe('createCreditRequest / findPendingCreditRequest', () => {
  it('refuses without a customer', async () => {
    await expect(
      createCreditRequest({ query: vi.fn() }, { customerId: null, requestedBy: 'user:1' }),
    ).rejects.toBeInstanceOf(CreditRequestError);
  });

  it('refuses when a pending request already exists', async () => {
    const db = {
      query: vi.fn(async () => [[{ id: 'customer_credit_request:1', status: 'pending' }]]),
    };
    await expect(
      createCreditRequest(db, { customerId: 'customer:1', requestedBy: 'user:1' }),
    ).rejects.toMatchObject({ code: 'already_pending' });
  });

  it('creates a pending row', async () => {
    const created = { id: 'customer_credit_request:2', status: 'pending' };
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[]])
        .mockResolvedValueOnce([[created]]),
    };
    await expect(
      createCreditRequest(db, {
        customerId: 'customer:1',
        requestedBy: 'user:1',
        orderId: 'order:9',
      }),
    ).resolves.toEqual(created);
  });

  it('finds the latest pending request', async () => {
    const row = { id: 'customer_credit_request:3', status: 'pending' };
    const db = { query: vi.fn(async () => [[row]]) };
    await expect(findPendingCreditRequest(db, 'customer:1')).resolves.toEqual(row);
  });
});

describe('approveCreditRequest / rejectCreditRequest', () => {
  it('rejects via claim', async () => {
    const db = {
      query: vi.fn(async () => [[{ id: 'customer_credit_request:1' }]]),
    };
    await expect(
      rejectCreditRequest(db, { id: 'customer_credit_request:1' }, 'user:boss'),
    ).resolves.toBe('rejected');
  });

  it('expires when the customer is deleted', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 'customer:1', deleted_at: '2026-10-10' }]])
        .mockResolvedValueOnce([[{ id: 'customer_credit_request:1' }]]),
    };
    await expect(
      approveCreditRequest(
        db,
        { id: 'customer_credit_request:1', customer: { id: 'customer:1' } as never },
        'user:boss',
        5000,
      ),
    ).resolves.toBe('expired');
  });

  it('approves with an optional limit and writes credit_allowed', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 'customer:1', deleted_at: null }]])
        .mockResolvedValueOnce([[{ id: 'customer_credit_request:1' }]])
        .mockResolvedValueOnce([[]]),
    };
    await expect(
      approveCreditRequest(
        db,
        { id: 'customer_credit_request:1', customer: { id: 'customer:1' } as never },
        'user:boss',
        10000,
      ),
    ).resolves.toBe('approved');
    expect(db.query).toHaveBeenCalledTimes(3);
    const writeSql = String(db.query.mock.calls[2][0]);
    expect(writeSql).toContain('credit_allowed = true');
    expect(db.query.mock.calls[2][1]).toMatchObject({ limit: 10000 });
  });

  it('approves with no ceiling when limit is empty', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 'customer:1', deleted_at: null }]])
        .mockResolvedValueOnce([[{ id: 'customer_credit_request:1' }]])
        .mockResolvedValueOnce([[]]),
    };
    await expect(
      approveCreditRequest(
        db,
        { id: 'customer_credit_request:1', customer: { id: 'customer:1' } as never },
        'user:boss',
        null,
      ),
    ).resolves.toBe('approved');
    expect(db.query.mock.calls[2][1]).toMatchObject({ limit: null });
  });

  it('returns taken when another approver claimed first', async () => {
    const db = {
      query: vi
        .fn()
        .mockResolvedValueOnce([[{ id: 'customer:1', deleted_at: null }]])
        .mockResolvedValueOnce([[]]),
    };
    await expect(
      approveCreditRequest(
        db,
        { id: 'customer_credit_request:1', customer: { id: 'customer:1' } as never },
        'user:boss',
      ),
    ).resolves.toBe('taken');
  });

  it('uses CustomerCreditRequestStatus pending constant', () => {
    expect(CustomerCreditRequestStatus.pending).toBe('pending');
  });
});
