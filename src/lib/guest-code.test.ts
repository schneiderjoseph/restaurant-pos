import { describe, expect, it } from 'vitest';
import {
  canRegisterGuestFromSearch,
  dropSupersededStays,
  canonicalGuestNameKey,
  generateWalkInGuestCode,
  guestCodePrefixFromName,
  guestMatchesSearchTerm,
  namesAreSamePerson,
  previewGuestCode,
  isAsiGuest,
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

describe('dropSupersededStays', () => {
  const stay = (checkin: number, inHouse: boolean, guestId: number | null = 7) => ({
    id: `customer:asi_fd_${checkin}`,
    source: 'asi-fd',
    asi_guest_id: guestId,
    asi_checkin_id: checkin,
    in_house: inHouse,
  });

  it('hides a checked-out stay when the same guest is in-house again', () => {
    const result = dropSupersededStays([stay(1, false), stay(2, true)]);
    expect(result.map((g) => g.asi_checkin_id)).toEqual([2]);
  });

  it('keeps only the latest checked-out stay of a guest', () => {
    const result = dropSupersededStays([stay(3, false), stay(1, false)]);
    expect(result.map((g) => g.asi_checkin_id)).toEqual([3]);
  });

  it('leaves walk-ins, other guests and stays without guest id alone', () => {
    const walkIn = { source: 'walk-in', asi_guest_id: null, asi_checkin_id: null, in_house: false };
    const result = dropSupersededStays([walkIn, stay(1, false), stay(2, false, 8), stay(4, false, null)]);
    expect(result).toHaveLength(4);
  });
});

describe('guestMatchesSearchTerm by phone', () => {
  const guest = { name: 'Ana Lima', guest_code: 'LIMA100', room: null, phone: '+509 3456-1234', email: null };

  it('matches phone digits whatever the formatting', () => {
    expect(guestMatchesSearchTerm(guest, '34561234')).toBe(true);
    expect(guestMatchesSearchTerm(guest, '3456 1234')).toBe(true);
    expect(guestMatchesSearchTerm(guest, '509-3456')).toBe(true);
    expect(guestMatchesSearchTerm({ ...guest, phone: 50934561234 }, '3456 1234')).toBe(true);
  });

  it('ignores digit runs that are too short or mixed with a name', () => {
    expect(guestMatchesSearchTerm(guest, '93')).toBe(false);
    expect(guestMatchesSearchTerm(guest, 'Paul 509')).toBe(false);
  });

  it('does not match a different number', () => {
    expect(guestMatchesSearchTerm(guest, '3456 9999')).toBe(false);
  });
});

describe('isAsiGuest', () => {
  it('is true only for a guest that comes from ASI FrontDesk', () => {
    expect(isAsiGuest({ source: 'asi-fd' })).toBe(true);
    expect(isAsiGuest({ source: 'walk-in' })).toBe(false);
    expect(isAsiGuest({ source: 'local' })).toBe(false);
    expect(isAsiGuest({ source: null })).toBe(false);
    expect(isAsiGuest(undefined)).toBe(false);
  });
});
