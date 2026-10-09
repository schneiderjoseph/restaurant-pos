import { describe, expect, it } from 'vitest';
import { isAnonymousGuest, placeholderGuestName } from '@/lib/guest.ts';

describe('placeholderGuestName', () => {
  it('flags names that stand for an anonymous cash guest', () => {
    for (const name of ['Cash', 'cash', 'Cash Couple', 'Cash Pignon', 'Client', 'Clients 2',
      'Passant', 'Anonyme', 'Walk in', 'Walk-in', 'Test', 'xxx', 'Inconnu']) {
      expect(placeholderGuestName(name), name).toBe('anonymous');
    }
  });

  it('flags a room typed as a name', () => {
    for (const name of ['Ch-21', 'Chambre32', 'chambre 32', 'Room 4', 'Suite 2B', 'CHB 7']) {
      expect(placeholderGuestName(name), name).toBe('room');
    }
  });

  it('keeps real names', () => {
    for (const name of ['Jean Yonel Casimir', 'Faline Bar', 'Mme Eric Geatjens', 'Figaro',
      'Chantal Michel', 'Romanus Brutus', '']) {
      expect(placeholderGuestName(name), name).toBeNull();
    }
  });
});

describe('isAnonymousGuest', () => {
  it('is the customer tagged anonymous', () => {
    expect(isAnonymousGuest({ tags: ['walk-in', 'anonymous', 'cash'] })).toBe(true);
    expect(isAnonymousGuest({ tags: ['walk-in'] })).toBe(false);
    expect(isAnonymousGuest(undefined)).toBe(false);
  });
});
