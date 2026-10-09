import { describe, expect, it } from 'vitest';
import {
  findCustomerByIdDocument,
  hasWalkInContact,
  maskIdDocument,
  normalizeIdDocument,
  walkInRefusal,
} from '@/lib/customer-id-document.ts';

describe('normalizeIdDocument', () => {
  it('keeps letters and digits only, uppercased', () => {
    expect(normalizeIdDocument(' 003-456-789-0 ')).toBe('0034567890');
    expect(normalizeIdDocument('rd 12 34é')).toBe('RD1234E');
  });

  it('is empty for nothing', () => {
    expect(normalizeIdDocument(undefined)).toBe('');
    expect(normalizeIdDocument(' - ')).toBe('');
  });
});

describe('maskIdDocument', () => {
  it('shows only the last four characters', () => {
    expect(maskIdDocument('003-456-789-0')).toBe('••••7890');
  });

  it('hides a short number entirely', () => {
    expect(maskIdDocument('1234')).toBe('••••');
  });

  it('is empty when there is no number', () => {
    expect(maskIdDocument(null)).toBe('');
  });
});

describe('hasWalkInContact', () => {
  it('refuses a walk-in with neither phone nor ID', () => {
    expect(hasWalkInContact({})).toBe(false);
    expect(hasWalkInContact({ phone: '  ', idDocument: ' - ' })).toBe(false);
  });

  it('accepts a phone alone', () => {
    expect(hasWalkInContact({ phone: '+509 3456-1234' })).toBe(true);
  });

  it('refuses a phone too short to be a number', () => {
    expect(hasWalkInContact({ phone: '123' })).toBe(false);
  });

  it('refuses a made-up phone', () => {
    expect(hasWalkInContact({ phone: '+509 2121 2121' })).toBe(false);
    expect(hasWalkInContact({ phone: '0000 0000' })).toBe(false);
  });

  it('accepts an ID document alone', () => {
    expect(hasWalkInContact({ idDocument: '003-456-789-0' })).toBe(true);
  });
});

describe('walkInRefusal', () => {
  it('sends anonymous names and rooms elsewhere, whatever the contact', () => {
    expect(walkInRefusal({ name: 'Cash', phone: '+509 3747 3889' })).toBe('menu:guest.anonymousName');
    expect(walkInRefusal({ name: 'Ch-21', phone: '+509 3747 3889' })).toBe('menu:guest.roomAsName');
  });

  it('names a made-up phone apart from a missing one', () => {
    expect(walkInRefusal({ name: 'Marie Joseph', phone: '+509 2121 2121' })).toBe('menu:guest.fakePhone');
    expect(walkInRefusal({ name: 'Marie Joseph' })).toBe('menu:guest.contactRequired');
  });

  it('lets a real walk-in through', () => {
    expect(walkInRefusal({ name: 'Marie Joseph', phone: '+509 3747 3889' })).toBeNull();
    expect(walkInRefusal({ name: 'Marie Joseph', phone: '0000 0000', idDocument: '003-456' })).toBeNull();
  });
});

describe('findCustomerByIdDocument', () => {
  it('looks up the normalized number', async () => {
    const calls: Array<Record<string, unknown> | undefined> = [];
    const db = {
      query: async (_sql: string, params?: Record<string, unknown>) => {
        calls.push(params);
        return [[{ id: 'customer:1', name: 'Marie' }]];
      },
    };
    const found = await findCustomerByIdDocument(db, '003-456-789-0');
    expect(found?.name).toBe('Marie');
    expect(calls[0]).toEqual({ number: '0034567890' });
  });

  it('does not query without a number', async () => {
    let queried = false;
    const db = { query: async () => { queried = true; return [[]]; } };
    expect(await findCustomerByIdDocument(db, ' ')).toBeUndefined();
    expect(queried).toBe(false);
  });
});
