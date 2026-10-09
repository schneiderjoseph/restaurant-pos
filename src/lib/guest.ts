import { Customer } from '@/api/model/customer.ts';
import { Order } from '@/api/model/order.ts';
import { formatGuestLabel, formatPersonName } from '@/lib/guest-label.ts';
import {formatTableLabel} from "@/lib/table-label.ts";

export { formatGuestLabel, formatPersonName } from '@/lib/guest-label.ts';

/** Prefer guest code when present (admin / lookup secondary line). */
export function guestCodeLabel(
  customer?: Pick<Customer, 'guest_code' | 'name'> | null
): string {
  if (!customer) {
    return '';
  }
  const code = customer.guest_code?.trim();
  if (code) {
    return code;
  }
  return formatPersonName(customer.name);
}

/** Prefer customer name for tickets / KDS / order display. */
export function guestDisplayLabel(
  customer?: Pick<Customer, 'guest_code' | 'name'> | null
): string {
  if (!customer) {
    return '';
  }
  const name = formatPersonName(customer.name);
  if (name) {
    return name;
  }
  return customer.guest_code?.trim() ?? '';
}

/** Build "Prénom Nom" from walk-in fields. */
export function joinGuestName(firstName?: string, lastName?: string): string {
  return [firstName, lastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

/** Strip accents and keep A–Z letters only. */
function lettersOnlyUpper(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

/** Name words normalized (accents stripped, uppercased). */
export function guestNameTokens(name?: string): string[] {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * Order-independent identity key.
 * "John Michel" and "Michel John" → "JOHN MICHEL"
 */
export function canonicalGuestNameKey(name?: string): string {
  return [...guestNameTokens(name)].sort().join(' ');
}

/** True when both names have the same words (any order). */
export function namesAreSamePerson(a?: string | null, b?: string | null): boolean {
  const left = canonicalGuestNameKey(a ?? undefined);
  const right = canonicalGuestNameKey(b ?? undefined);
  return Boolean(left) && left === right;
}

/** Digits only, so "+509 3456-1234" and "50934561234" compare equal. */
export function phoneDigits(value?: string | number | null): string {
  return value == null ? '' : String(value).replace(/\D/g, '');
}

/** Shortest digit run treated as a phone search (keeps "12" a room/table lookup). */
export const PHONE_SEARCH_MIN_DIGITS = 3;

type SearchableGuest = Pick<Customer, 'name' | 'guest_code' | 'room' | 'phone' | 'email'>
  & Partial<Pick<Customer, 'id_document_number' | 'asi_folio_no' | 'asi_guest_id' | 'number'>>;

/** Letters and digits only, so "AB-123 456" and "ab123456" compare equal. */
const alphanumeric = (value: unknown): string =>
  String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const ID_SEARCH_MIN_CHARS = 3;

/** One typed word against everything but the name: room, code, phone, email, ID document, folio. */
function guestFieldMatchesToken(guest: SearchableGuest, token: string): boolean {
  const lower = token.toLowerCase();
  const room = guest.room != null ? String(guest.room).trim().toLowerCase() : '';

  // "20", "ch20", "r20", "#20": the room itself, not every number that contains 20.
  const roomQuery = lower.replace(/^(?:#|chambre|ch|room|r)/, '');
  if (room && roomQuery && room === roomQuery) {
    return true;
  }

  const texts = [guest.guest_code, guest.email, guest.asi_folio_no]
    .map((value) => String(value ?? '').toLowerCase())
    .filter(Boolean);
  if (texts.some((text) => text.includes(lower.replace(/^#/, '')))) {
    return true;
  }

  const digits = /\p{L}/u.test(token) ? '' : phoneDigits(token);
  if (digits.length >= PHONE_SEARCH_MIN_DIGITS && phoneDigits(guest.phone).includes(digits)) {
    return true;
  }

  // Customer number: "C-000123", "c123".
  const customerNumber = /^c-?0*(\d{1,9})$/i.exec(token);
  if (customerNumber && guest.number != null && guest.number === Number(customerNumber[1])) {
    return true;
  }

  const idQuery = alphanumeric(token);
  if (idQuery.length >= ID_SEARCH_MIN_CHARS) {
    if (alphanumeric(guest.id_document_number).includes(idQuery)) return true;
    if (guest.asi_guest_id != null && String(guest.asi_guest_id) === idQuery) return true;
  }

  return false;
}

/**
 * Search match on any detail of the guest: name, room, code, phone (any formatting),
 * email, ID document number, ASI folio.
 * Several words may mix details and come in any order: "Michel John" finds "John Michel",
 * "20 jean" finds Jean in room 20.
 */
export function guestMatchesSearchTerm(
  guest: SearchableGuest,
  term: string,
  options: { fuzzy?: boolean } = {},
): boolean {
  const q = term.trim();
  if (!q) {
    return true;
  }

  const qLower = q.toLowerCase();
  const extras = [
    guest.guest_code,
    guest.room != null ? String(guest.room) : '',
    guest.phone != null ? String(guest.phone) : '',
    guest.email,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (extras.includes(qLower)) {
    return true;
  }

  // Phone-like query only (no letters): "Jean 509" must not match every 509 number.
  const qDigits = /\p{L}/u.test(q) ? '' : phoneDigits(q);
  if (qDigits.length >= PHONE_SEARCH_MIN_DIGITS && phoneDigits(guest.phone).includes(qDigits)) {
    return true;
  }

  const name = guest.name ?? '';
  if (name.toLowerCase().includes(qLower)) {
    return true;
  }

  // The whole query as one detail: an ID number or a phone typed with spaces.
  if (guestFieldMatchesToken(guest, q.replace(/\s+/g, ''))) {
    return true;
  }

  const words = q.split(/\s+/).filter(Boolean);
  const nameTokens = guestNameTokens(name);

  // Each typed word must match a name word (prefix OK while typing) or another detail.
  return words.every((word) => {
    const wordTokens = guestNameTokens(word);
    const inName = wordTokens.length > 0 && wordTokens.every((qt) =>
      nameTokens.some((nt) => nt.startsWith(qt) || nt.includes(qt)),
    );
    if (inName || guestFieldMatchesToken(guest, word)) {
      return true;
    }
    return Boolean(options.fuzzy) && wordTokens.length > 0 && wordTokens.every((qt) =>
      nameTokens.some((nt) => nameWordIsClose(qt, nt)),
    );
  });
}

/** Edit distance between two words, given up as soon as it passes `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let beforePrevious: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      // Two neighbouring letters swapped ("Jaen") count as one slip.
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, beforePrevious[j - 2] + 1);
      }
      current.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    beforePrevious = previous;
    previous = current;
  }
  return previous[b.length];
}

const FUZZY_MIN_LETTERS = 4;
const FUZZY_TWO_SLIPS_FROM = 8;

/**
 * A typed word spelled almost like a name word: one slip from 4 letters, two from 8.
 * Also true against the start of the name word, so it works while typing.
 */
function nameWordIsClose(typed: string, nameWord: string): boolean {
  if (typed.length < FUZZY_MIN_LETTERS) return false;
  const max = typed.length >= FUZZY_TWO_SLIPS_FROM ? 2 : 1;
  if (editDistance(typed, nameWord, max) <= max) return true;
  return nameWord.length > typed.length
    && editDistance(typed, nameWord.slice(0, typed.length), max) <= max;
}

/**
 * Guests for a search: exact matches first, then the ones whose name is only spelled
 * close to what was typed ("Dupond" for "Dupont").
 */
export function searchGuests<T extends SearchableGuest>(
  guests: readonly T[],
  term: string,
): { exact: T[]; close: T[] } {
  const trimmed = term.trim();
  if (!trimmed) {
    return { exact: [...guests], close: [] };
  }
  const exact: T[] = [];
  const close: T[] = [];
  for (const guest of guests) {
    if (guestMatchesSearchTerm(guest, trimmed)) {
      exact.push(guest);
    } else if (guestMatchesSearchTerm(guest, trimmed, { fuzzy: true })) {
      close.push(guest);
    }
  }
  return { exact, close };
}

/**
 * Name-derived code prefix (order-independent).
 * - "Ricardo Michel" / "Michel Ricardo" → MICR (sorted: MICHEL, RICARDO)
 * - "Jean" → JEAN
 * - empty → W
 */
export function guestCodePrefixFromName(name?: string): string {
  const words = [...guestNameTokens(name)].sort();

  if (words.length === 0) {
    return 'W';
  }

  if (words.length === 1) {
    const single = words[0].slice(0, 4);
    return single.length >= 2 ? single : `${single}X`.slice(0, 3);
  }

  // First 3 of first sorted word + first letter of last sorted word
  return `${words[0].slice(0, 3)}${words[words.length - 1].slice(0, 1)}`.slice(0, 4);
}

/**
 * Stable preview code for UI while typing (same person → same code even if word order differs).
 * Use generateWalkInGuestCode() when the user clicks "new code" or on collision retry.
 */
export function previewGuestCode(name?: string): string {
  const prefix = guestCodePrefixFromName(name);
  const source = canonicalGuestNameKey(name);
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  }
  const digits = String(100 + (hash % 900));
  return `${prefix}${digits}`;
}

/**
 * Walk-in guest code from name + random digits (e.g. RICM482).
 * Collision is rare; callers should still verify uniqueness if needed.
 */
export function generateWalkInGuestCode(name?: string): string {
  const prefix = guestCodePrefixFromName(name);
  const digits = String(100 + Math.floor(Math.random() * 900)); // 100–999
  return `${prefix}${digits}`;
}

/** True when the search text looks like a person name (not just a room #). */
export function canRegisterGuestFromSearch(term: string): boolean {
  const trimmed = term.trim();
  if (trimmed.length < 2) {
    return false;
  }
  return lettersOnlyUpper(trimmed).length >= 2;
}

/**
 * ASI FrontDesk creates one customer per stay (same asi_guest_id). A checked-out
 * stay can stay listed because of its note; hide it once a newer stay of the same
 * guest is listed (in-house first, else the latest check-in). Other rows untouched.
 */
export function dropSupersededStays<
  T extends Pick<Customer, 'source' | 'asi_guest_id' | 'asi_checkin_id' | 'in_house'>,
>(guests: T[]): T[] {
  const keep = new Map<number, T>();
  for (const guest of guests) {
    if (guest.source !== 'asi-fd' || guest.asi_guest_id == null) {
      continue;
    }
    const current = keep.get(guest.asi_guest_id);
    if (
      !current
      || (guest.in_house && !current.in_house)
      || (Boolean(guest.in_house) === Boolean(current.in_house)
        && (guest.asi_checkin_id ?? 0) > (current.asi_checkin_id ?? 0))
    ) {
      keep.set(guest.asi_guest_id, guest);
    }
  }
  return guests.filter((guest) =>
    guest.source !== 'asi-fd'
    || guest.asi_guest_id == null
    || guest.in_house
    || keep.get(guest.asi_guest_id) === guest,
  );
}

export function orderZoneLabel(order?: Pick<Order, 'floor'> | null): string {
  return order?.floor?.name?.trim() ?? '';
}

export function orderContextLabel(order?: Order | null): string {
  if (!order) {
    return '';
  }

  const guest = formatGuestLabel(order.customer);
  const zone = orderZoneLabel(order);
  const table = formatTableLabel(order.table);

  const parts = [guest, zone, table].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' · ');
  }

  return order.order_type?.name ?? '';
}

/**
 * A guest that comes from ASI FrontDesk: ASI owns the record, so the POS never edits its
 * identity or contact details. The staff note stays editable: it is a POS field.
 */
export const isAsiGuest = (customer?: Pick<Customer, 'source'> | null): boolean =>
  customer?.source === 'asi-fd';
