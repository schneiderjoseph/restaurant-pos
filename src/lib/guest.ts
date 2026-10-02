import { Customer } from '@/api/model/customer.ts';
import { Order } from '@/api/model/order.ts';
import { formatGuestLabel } from '@/lib/guest-label.ts';

export { formatGuestLabel } from '@/lib/guest-label.ts';

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
  return customer.name?.trim() ?? '';
}

/** Prefer customer name for tickets / KDS / order display. */
export function guestDisplayLabel(
  customer?: Pick<Customer, 'guest_code' | 'name'> | null
): string {
  if (!customer) {
    return '';
  }
  const name = customer.name?.trim();
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

/**
 * Search match: code/room/phone/email substring, phone digits (any formatting),
 * OR name substring,
 * OR every query word appears in the guest name (order-independent).
 * So typing "Michel John" finds "John Michel".
 */
export function guestMatchesSearchTerm(
  guest: Pick<Customer, 'name' | 'guest_code' | 'room' | 'phone' | 'email'>,
  term: string,
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

  const queryTokens = guestNameTokens(q);
  if (queryTokens.length === 0) {
    return false;
  }

  const nameTokens = guestNameTokens(name);
  if (nameTokens.length === 0) {
    return false;
  }

  // Each typed word must match a name word (prefix OK while typing).
  return queryTokens.every((qt) =>
    nameTokens.some((nt) => nt.startsWith(qt) || nt.includes(qt)),
  );
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
  const table = order.table
    ? `${order.table.name ?? ''}${order.table.number ?? ''}`.trim()
    : '';

  const parts = [guest, zone, table].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(' · ');
  }

  return order.order_type?.name ?? '';
}
