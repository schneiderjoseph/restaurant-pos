import { describe, expect, it } from 'vitest';
import {
  canRegisterGuestFromSearch,
  canonicalGuestNameKey,
  generateWalkInGuestCode,
  guestCodePrefixFromName,
  guestMatchesSearchTerm,
  namesAreSamePerson,
  previewGuestCode,
} from '@/lib/guest.ts';

describe('guestCodePrefixFromName', () => {
  it('uses sorted words so order does not matter', () => {
    expect(guestCodePrefixFromName('Ricardo Michel')).toBe('MICR');
    expect(guestCodePrefixFromName('Michel Ricardo')).toBe('MICR');
    expect(guestCodePrefixFromName('jean-pierre dupont')).toBe('DUPP');
  });

  it('uses up to 4 letters for a single word', () => {
    expect(guestCodePrefixFromName('Jean')).toBe('JEAN');
    expect(guestCodePrefixFromName('Jo')).toBe('JO');
  });

  it('strips accents', () => {
    expect(guestCodePrefixFromName('José Álvarez')).toBe('ALVJ');
  });

  it('falls back to W when empty', () => {
    expect(guestCodePrefixFromName('')).toBe('W');
    expect(guestCodePrefixFromName('   ')).toBe('W');
  });
});

describe('generateWalkInGuestCode', () => {
  it('prefixes with name letters and ends with 3 digits', () => {
    const code = generateWalkInGuestCode('Ricardo Michel');
    expect(code).toMatch(/^MICR\d{3}$/);
  });
});

describe('previewGuestCode', () => {
  it('is stable for the same name and word order', () => {
    expect(previewGuestCode('Ricardo Michel')).toBe(previewGuestCode('Ricardo Michel'));
    expect(previewGuestCode('John Michel')).toBe(previewGuestCode('Michel John'));
    expect(previewGuestCode('Ricardo Michel')).toMatch(/^MICR\d{3}$/);
  });
});

describe('namesAreSamePerson', () => {
  it('treats reversed full names as the same person', () => {
    expect(namesAreSamePerson('John Michel', 'Michel John')).toBe(true);
    expect(namesAreSamePerson('Jhon Michel', 'Michel Jhon')).toBe(true);
    expect(canonicalGuestNameKey('Michel John')).toBe('JOHN MICHEL');
  });

  it('does not equate different people', () => {
    expect(namesAreSamePerson('John Michel', 'John Paul')).toBe(false);
    expect(namesAreSamePerson('John', 'John Michel')).toBe(false);
  });
});

describe('guestMatchesSearchTerm', () => {
  const guest = { name: 'John Michel', guest_code: 'JOHM100', room: null, phone: null, email: null };

  it('matches reversed word order', () => {
    expect(guestMatchesSearchTerm(guest, 'Michel John')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'michel john')).toBe(true);
  });

  it('matches partial tokens while typing', () => {
    expect(guestMatchesSearchTerm(guest, 'Mich Joh')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'John')).toBe(true);
  });

  it('does not match unrelated names', () => {
    expect(guestMatchesSearchTerm(guest, 'Paul Estimé')).toBe(false);
  });
});

describe('canRegisterGuestFromSearch', () => {
  it('allows real names', () => {
    expect(canRegisterGuestFromSearch('Ricardo')).toBe(true);
    expect(canRegisterGuestFromSearch('Ricardo Michel')).toBe(true);
  });

  it('rejects room numbers and tiny input', () => {
    expect(canRegisterGuestFromSearch('18')).toBe(false);
    expect(canRegisterGuestFromSearch('A')).toBe(false);
    expect(canRegisterGuestFromSearch('')).toBe(false);
  });
});
