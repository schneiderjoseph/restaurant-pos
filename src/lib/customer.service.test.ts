import { describe, expect, it } from 'vitest';
import type { Customer } from '@/api/model/customer.ts';
import {
  canEditCustomerIdentity,
  cleanList,
  createWalkInCustomer,
  CustomerIdDocumentTakenError,
  customerNumberLabel,
  findWalkInMatches,
  mergeCustomers,
  mergedCustomerFields,
  parseCustomerNumber,
  sameCustomer,
  softDeleteCustomer,
} from '@/lib/customer.service.ts';
import { isBirthdayToday } from '@/lib/customer-preferences.ts';

type Call = { sql: string; params?: Record<string, unknown> };

const fakeDb = (respond: (sql: string, params?: Record<string, unknown>) => unknown = () => [[]]) => {
  const calls: Call[] = [];
  return {
    calls,
    query: async (sql: string, params?: Record<string, unknown>) => {
      calls.push({ sql, params });
      return respond(sql, params);
    },
  };
};

const customer = (fields: Partial<Customer>): Customer => ({ id: 'customer:x', name: '', ...fields }) as Customer;

describe('customer numbers', () => {
  it('formats and parses C-000123', () => {
    expect(customerNumberLabel({ number: 123 })).toBe('C-000123');
    expect(customerNumberLabel({ number: null })).toBe('');
    expect(parseCustomerNumber('C-000123')).toBe(123);
    expect(parseCustomerNumber('c123')).toBe(123);
    expect(parseCustomerNumber('Claude')).toBeNull();
    expect(parseCustomerNumber('123')).toBeNull();
  });
});

describe('cleanList', () => {
  it('trims, drops empties and case-insensitive duplicates', () => {
    expect(cleanList([' Arachides ', 'arachides', '', null, 'Gluten'])).toEqual(['Arachides', 'Gluten']);
  });
});

describe('sameCustomer', () => {
  it('compares ids whatever their form', () => {
    expect(sameCustomer('customer:a', { id: 'customer:a' })).toBe(true);
    expect(sameCustomer('customer:a', 'customer:b')).toBe(false);
    expect(sameCustomer(undefined, undefined)).toBe(false);
  });
});

describe('createWalkInCustomer', () => {
  it('creates a walk-in with its author and normalized ID', async () => {
    const db = fakeDb(() => [[{ id: 'customer:new', name: 'Jean Pierre' }]]);
    const created = await createWalkInCustomer(db, {
      name: '  Jean   Pierre ',
      guestCode: 'JEPI1',
      phone: '+509 3747 3889',
      idDocument: '003-456-789-0',
      idDocumentType: 'cin',
      createdBy: { id: 'user:1' },
    });
    expect(created.id).toBe('customer:new');
    const content = db.calls[0].params?.content as Record<string, unknown>;
    expect(content).toMatchObject({
      name: 'Jean Pierre',
      guest_code: 'JEPI1',
      source: 'walk-in',
      phone: '+509 3747 3889',
      id_document_number: '0034567890',
      id_document_type: 'cin',
    });
    expect(String(content.created_by)).toContain('user:1');
  });

  it('turns the unique-index refusal into CustomerIdDocumentTakenError', async () => {
    const db = {
      query: async () => {
        throw new Error("Database index `customer_id_document_key` already contains '0034567890'");
      },
    };
    await expect(
      createWalkInCustomer(db, { name: 'Marie', guestCode: 'MA1', idDocument: '0034567890' }),
    ).rejects.toBeInstanceOf(CustomerIdDocumentTakenError);
  });
});

describe('findWalkInMatches', () => {
  it('returns same-phone and same-name clients, both reasons first', async () => {
    const db = fakeDb((sql) => {
      if (sql.includes('phone_e164 = $e164')) {
        return [[{ id: 'customer:phone', name: 'Rose Pierre' }, { id: 'customer:both', name: 'Jean Pierre' }]];
      }
      return [[
        { id: 'customer:both', name: 'Jean Pierre' },
        { id: 'customer:name', name: 'Pierre Jean' },
        { id: 'customer:other', name: 'Jean Pierre Louis' },
      ]];
    });
    const matches = await findWalkInMatches(db, { name: 'Jean Pierre', phone: '3747-3889' });
    expect(matches.map((match) => [match.customer.id, match.reasons])).toEqual([
      ['customer:both', ['phone', 'name']],
      ['customer:phone', ['phone']],
      ['customer:name', ['name']],
    ]);
    // Deleted and merged clients are never suggested.
    expect(db.calls.every((call) => call.sql.includes('deleted_at = NONE AND merged_into = NONE'))).toBe(true);
  });

  it('skips the phone lookup without a usable phone', async () => {
    const db = fakeDb();
    await findWalkInMatches(db, { name: 'Jean', phone: '45' });
    expect(db.calls).toHaveLength(1);
  });
});

describe('soft delete and merge', () => {
  it('never deletes: it sets deleted_at', async () => {
    const db = fakeDb();
    await softDeleteCustomer(db, 'customer:a', { reason: ' doublon ' });
    expect(db.calls[0].sql).toMatch(/UPDATE \$id SET deleted_at = time::now\(\)/);
    expect(db.calls[0].sql).not.toMatch(/DELETE/);
    expect(db.calls[0].params?.reason).toBe('doublon');
  });

  it('takes the missing details and the union of preferences', () => {
    const keep = customer({ id: 'customer:keep', phone: '+509 1111 1111', allergies: ['Gluten'], notes: 'Aime le griot' });
    const drop = customer({
      id: 'customer:drop',
      phone: '+509 2222 2222',
      email: 'a@b.c',
      id_document_number: 'NIF1',
      id_document_type: 'nif',
      allergies: ['gluten', 'Arachides'],
      notes: 'Table 4',
      vip: true,
    });
    expect(mergedCustomerFields(keep, drop)).toEqual({
      email: 'a@b.c',
      id_document_number: 'NIF1',
      id_document_type: 'nif',
      notes: 'Aime le griot\nTable 4',
      allergies: ['Gluten', 'Arachides'],
      vip: true,
    });
  });

  it('merges in one transaction and refuses a self-merge', async () => {
    const db = fakeDb();
    await mergeCustomers(db, customer({ id: 'customer:keep' }), customer({ id: 'customer:drop' }));
    expect(db.calls[0].sql).toMatch(/BEGIN TRANSACTION[\s\S]*merged_into = \$keep[\s\S]*COMMIT TRANSACTION/);
    await expect(
      mergeCustomers(db, customer({ id: 'customer:a' }), customer({ id: 'customer:a' })),
    ).rejects.toThrow();
  });
});

describe('canEditCustomerIdentity', () => {
  const walkIn = { source: 'walk-in', created_by: 'user:1' } as Customer;
  const none = () => false;

  it('lets the server who registered the walk-in edit it', () => {
    expect(canEditCustomerIdentity(walkIn, { id: 'user:1' }, none)).toBe(true);
    expect(canEditCustomerIdentity(walkIn, { id: 'user:2' }, none)).toBe(false);
  });

  it('lets a manager edit any non-hotel client', () => {
    const manager = (module: string) => module === 'admin.customers.update';
    expect(canEditCustomerIdentity(walkIn, { id: 'user:2' }, manager)).toBe(true);
    expect(canEditCustomerIdentity({ source: 'asi-fd', asi_guest_id: 3 } as Customer, { id: 'user:2' }, manager)).toBe(false);
  });

  it('does not let Front Desk edit identity on the server guest list', () => {
    const fd = (module: string) => module === 'frontdesk.checkin' || module === 'frontdesk';
    expect(canEditCustomerIdentity(walkIn, { id: 'user:9' }, fd)).toBe(false);
  });
});

describe('isBirthdayToday', () => {
  it('compares month and day only', () => {
    const today = new Date(2026, 9, 6);
    expect(isBirthdayToday('1990-10-06', today)).toBe(true);
    expect(isBirthdayToday('1990-10-07', today)).toBe(false);
    expect(isBirthdayToday('', today)).toBe(false);
  });
});
