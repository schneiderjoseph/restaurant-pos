import { describe, expect, it } from 'vitest';
import {
  canRegisterGuestFromSearch,
  dropSupersededStays,
  canonicalGuestNameKey,
  generateWalkInGuestCode,
  guestCodePrefixFromName,
  guestMatchesSearchTerm,
  searchGuests,
  namesAreSamePerson,
  previewGuestCode,
  isAsiGuest,
  isRoomGuest,
  sortGuestsNewestFirst,
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

describe('guestMatchesSearchTerm by any detail', () => {
  const guest = {
    name: 'Jean Dupont',
    guest_code: 'DUJE42',
    room: '20',
    phone: '+509 3456 1234',
    email: 'jean@example.com',
    id_document_number: 'AB-123 456',
    asi_folio_no: 'F-7781',
  };

  it('finds by room, however it is typed', () => {
    for (const term of ['20', 'ch20', 'CH 20', 'R20', 'chambre 20', '#20']) {
      expect(guestMatchesSearchTerm(guest, term), term).toBe(true);
    }
    expect(guestMatchesSearchTerm(guest, 'ch21')).toBe(false);
    expect(guestMatchesSearchTerm({ ...guest, room: '120', phone: '' }, 'ch20')).toBe(false);
  });

  it('finds by ID document, code, folio and email', () => {
    expect(guestMatchesSearchTerm(guest, 'ab123456')).toBe(true);
    expect(guestMatchesSearchTerm(guest, '123 456')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'DUJE')).toBe(true);
    expect(guestMatchesSearchTerm(guest, '7781')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'jean@ex')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'ZZ999')).toBe(false);
  });

  it('mixes details in one search', () => {
    expect(guestMatchesSearchTerm(guest, '20 jean')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'dupont ch20')).toBe(true);
    expect(guestMatchesSearchTerm(guest, 'paul 20')).toBe(false);
  });
});

describe('searchGuests with close spellings', () => {
  const guests = [
    { name: 'Jean Dupont', room: '20', phone: '', guest_code: '', email: '' },
    { name: 'Frederic Aka', room: '', phone: '', guest_code: '', email: '' },
    { name: 'Marie Dupond', room: '', phone: '', guest_code: '', email: '' },
  ];
  const names = (list: { name: string }[]) => list.map((guest) => guest.name);

  it('puts exact matches first and close spellings after', () => {
    const found = searchGuests(guests, 'dupont');
    expect(names(found.exact)).toEqual(['Jean Dupont']);
    expect(names(found.close)).toEqual(['Marie Dupond']);
  });

  it('forgives a typo, a swap and a missing letter', () => {
    expect(names(searchGuests(guests, 'frederik').close)).toEqual(['Frederic Aka']);
    expect(names(searchGuests(guests, 'fredreic').close)).toEqual(['Frederic Aka']);
    expect(names(searchGuests(guests, 'fedric').close)).toEqual([]);
    expect(names(searchGuests(guests, 'federic').close)).toEqual(['Frederic Aka']);
  });

  it('works while typing and stays strict on short words', () => {
    expect(names(searchGuests(guests, 'fredr').close)).toEqual(['Frederic Aka']);
    expect(searchGuests(guests, 'jon').close).toEqual([]);
    expect(searchGuests(guests, 'paul')).toEqual({ exact: [], close: [] });
  });

  it('returns everyone when nothing is typed', () => {
    expect(searchGuests(guests, '  ').exact).toHaveLength(3);
  });
});

describe('isRoomGuest', () => {
  it('is true for a guest with a room, in-house flag, stay tags or current stay', () => {
    expect(isRoomGuest({ room: '12', in_house: false, tags: [], current_stay: null })).toBe(true);
    expect(isRoomGuest({ room: '', in_house: true, tags: [], current_stay: null })).toBe(true);
    expect(isRoomGuest({ room: null, in_house: false, tags: ['in-house'], current_stay: null })).toBe(true);
    expect(isRoomGuest({ room: null, in_house: false, tags: ['manual-stay'], current_stay: null })).toBe(true);
    expect(isRoomGuest({ room: null, in_house: false, tags: [], current_stay: 'stay:1' })).toBe(true);
  });

  it('is false for a plain walk-in', () => {
    expect(isRoomGuest({
      room: null,
      in_house: false,
      tags: ['walk-in'],
      current_stay: null,
    })).toBe(false);
  });
});

describe('sortGuestsNewestFirst', () => {
  it('puts newest created_at first and missing dates last', () => {
    const sorted = sortGuestsNewestFirst([
      { created_at: '2026-01-01T10:00:00Z' },
      { created_at: null },
      { created_at: '2026-10-08T12:00:00Z' },
      { created_at: '2026-05-01T08:00:00Z' },
    ]);
    expect(sorted.map((g) => g.created_at)).toEqual([
      '2026-10-08T12:00:00Z',
      '2026-05-01T08:00:00Z',
      '2026-01-01T10:00:00Z',
      null,
    ]);
  });
});
