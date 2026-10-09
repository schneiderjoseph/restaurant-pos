/**
 * Phone numbers with a country calling code.
 *
 * A customer's phone is stored international ("+509 3747 3889"); the database derives
 * customer.phone_e164 ("+50937473889") from it with the same rules as toE164() below
 * (migrations/2026_10_06_customer_management.surql), so lookups compare one canonical form.
 */

export interface PhoneCountry {
  /** ISO 3166-1 alpha-2 */
  iso: string;
  /** Calling code, digits only */
  dial: string;
}

/** Haiti: a number typed without a country code is Haitian. */
export const DEFAULT_PHONE_COUNTRY = 'HT';
export const DEFAULT_PHONE_DIAL = '509';

/** Shortest digit run treated as a real phone (same as the database rule). */
export const MIN_PHONE_DIGITS = 6;

/** Haiti and its neighbours first, then the rest of the world by name. */
const PINNED: PhoneCountry[] = [
  { iso: 'HT', dial: '509' },
  { iso: 'DO', dial: '1' },
  { iso: 'US', dial: '1' },
  { iso: 'CA', dial: '1' },
  { iso: 'FR', dial: '33' },
];

const OTHERS: PhoneCountry[] = [
  { iso: 'AF', dial: '93' }, { iso: 'AL', dial: '355' }, { iso: 'DZ', dial: '213' },
  { iso: 'AD', dial: '376' }, { iso: 'AO', dial: '244' }, { iso: 'AG', dial: '1' },
  { iso: 'AR', dial: '54' }, { iso: 'AM', dial: '374' }, { iso: 'AW', dial: '297' },
  { iso: 'AU', dial: '61' }, { iso: 'AT', dial: '43' }, { iso: 'AZ', dial: '994' },
  { iso: 'BS', dial: '1' }, { iso: 'BH', dial: '973' }, { iso: 'BD', dial: '880' },
  { iso: 'BB', dial: '1' }, { iso: 'BY', dial: '375' }, { iso: 'BE', dial: '32' },
  { iso: 'BZ', dial: '501' }, { iso: 'BJ', dial: '229' }, { iso: 'BO', dial: '591' },
  { iso: 'BA', dial: '387' }, { iso: 'BW', dial: '267' }, { iso: 'BR', dial: '55' },
  { iso: 'BG', dial: '359' }, { iso: 'BF', dial: '226' }, { iso: 'BI', dial: '257' },
  { iso: 'KH', dial: '855' }, { iso: 'CM', dial: '237' }, { iso: 'CV', dial: '238' },
  { iso: 'CF', dial: '236' }, { iso: 'TD', dial: '235' }, { iso: 'CL', dial: '56' },
  { iso: 'CN', dial: '86' }, { iso: 'CO', dial: '57' }, { iso: 'KM', dial: '269' },
  { iso: 'CG', dial: '242' }, { iso: 'CD', dial: '243' }, { iso: 'CR', dial: '506' },
  { iso: 'CI', dial: '225' }, { iso: 'HR', dial: '385' }, { iso: 'CU', dial: '53' },
  { iso: 'CW', dial: '599' }, { iso: 'CY', dial: '357' }, { iso: 'CZ', dial: '420' },
  { iso: 'DK', dial: '45' }, { iso: 'DJ', dial: '253' }, { iso: 'DM', dial: '1' },
  { iso: 'EC', dial: '593' }, { iso: 'EG', dial: '20' }, { iso: 'SV', dial: '503' },
  { iso: 'GQ', dial: '240' }, { iso: 'ER', dial: '291' }, { iso: 'EE', dial: '372' },
  { iso: 'ET', dial: '251' }, { iso: 'FI', dial: '358' }, { iso: 'GF', dial: '594' },
  { iso: 'GA', dial: '241' }, { iso: 'GM', dial: '220' }, { iso: 'GE', dial: '995' },
  { iso: 'DE', dial: '49' }, { iso: 'GH', dial: '233' }, { iso: 'GR', dial: '30' },
  { iso: 'GD', dial: '1' }, { iso: 'GP', dial: '590' }, { iso: 'GT', dial: '502' },
  { iso: 'GN', dial: '224' }, { iso: 'GW', dial: '245' }, { iso: 'GY', dial: '592' },
  { iso: 'HN', dial: '504' }, { iso: 'HK', dial: '852' }, { iso: 'HU', dial: '36' },
  { iso: 'IS', dial: '354' }, { iso: 'IN', dial: '91' }, { iso: 'ID', dial: '62' },
  { iso: 'IR', dial: '98' }, { iso: 'IQ', dial: '964' }, { iso: 'IE', dial: '353' },
  { iso: 'IL', dial: '972' }, { iso: 'IT', dial: '39' }, { iso: 'JM', dial: '1' },
  { iso: 'JP', dial: '81' }, { iso: 'JO', dial: '962' }, { iso: 'KZ', dial: '7' },
  { iso: 'KE', dial: '254' }, { iso: 'KR', dial: '82' }, { iso: 'KW', dial: '965' },
  { iso: 'LA', dial: '856' }, { iso: 'LV', dial: '371' }, { iso: 'LB', dial: '961' },
  { iso: 'LR', dial: '231' }, { iso: 'LY', dial: '218' }, { iso: 'LT', dial: '370' },
  { iso: 'LU', dial: '352' }, { iso: 'MG', dial: '261' }, { iso: 'MW', dial: '265' },
  { iso: 'MY', dial: '60' }, { iso: 'ML', dial: '223' }, { iso: 'MT', dial: '356' },
  { iso: 'MQ', dial: '596' }, { iso: 'MR', dial: '222' }, { iso: 'MU', dial: '230' },
  { iso: 'MX', dial: '52' }, { iso: 'MD', dial: '373' }, { iso: 'MC', dial: '377' },
  { iso: 'MA', dial: '212' }, { iso: 'MZ', dial: '258' }, { iso: 'NA', dial: '264' },
  { iso: 'NP', dial: '977' }, { iso: 'NL', dial: '31' }, { iso: 'NZ', dial: '64' },
  { iso: 'NI', dial: '505' }, { iso: 'NE', dial: '227' }, { iso: 'NG', dial: '234' },
  { iso: 'NO', dial: '47' }, { iso: 'PK', dial: '92' }, { iso: 'PA', dial: '507' },
  { iso: 'PY', dial: '595' }, { iso: 'PE', dial: '51' }, { iso: 'PH', dial: '63' },
  { iso: 'PL', dial: '48' }, { iso: 'PT', dial: '351' }, { iso: 'PR', dial: '1' },
  { iso: 'QA', dial: '974' }, { iso: 'RE', dial: '262' }, { iso: 'RO', dial: '40' },
  { iso: 'RU', dial: '7' }, { iso: 'RW', dial: '250' }, { iso: 'KN', dial: '1' },
  { iso: 'LC', dial: '1' }, { iso: 'VC', dial: '1' }, { iso: 'SA', dial: '966' },
  { iso: 'SN', dial: '221' }, { iso: 'RS', dial: '381' }, { iso: 'SL', dial: '232' },
  { iso: 'SG', dial: '65' }, { iso: 'SX', dial: '1' }, { iso: 'SK', dial: '421' },
  { iso: 'SI', dial: '386' }, { iso: 'SO', dial: '252' }, { iso: 'ZA', dial: '27' },
  { iso: 'ES', dial: '34' }, { iso: 'LK', dial: '94' }, { iso: 'SD', dial: '249' },
  { iso: 'SR', dial: '597' }, { iso: 'SE', dial: '46' }, { iso: 'CH', dial: '41' },
  { iso: 'SY', dial: '963' }, { iso: 'TW', dial: '886' }, { iso: 'TZ', dial: '255' },
  { iso: 'TH', dial: '66' }, { iso: 'TG', dial: '228' }, { iso: 'TT', dial: '1' },
  { iso: 'TN', dial: '216' }, { iso: 'TR', dial: '90' }, { iso: 'TC', dial: '1' },
  { iso: 'UG', dial: '256' }, { iso: 'UA', dial: '380' }, { iso: 'AE', dial: '971' },
  { iso: 'GB', dial: '44' }, { iso: 'UY', dial: '598' }, { iso: 'UZ', dial: '998' },
  { iso: 'VE', dial: '58' }, { iso: 'VN', dial: '84' }, { iso: 'VG', dial: '1' },
  { iso: 'VI', dial: '1' }, { iso: 'YE', dial: '967' }, { iso: 'ZM', dial: '260' },
  { iso: 'ZW', dial: '263' },
];

export const PHONE_COUNTRIES: PhoneCountry[] = [...PINNED, ...OTHERS];
export const PINNED_PHONE_COUNTRY_COUNT = PINNED.length;

export function findPhoneCountry(iso?: string | null): PhoneCountry {
  return (
    PHONE_COUNTRIES.find((country) => country.iso === iso) ??
    PHONE_COUNTRIES.find((country) => country.iso === DEFAULT_PHONE_COUNTRY)!
  );
}

/** "🇭🇹" from "HT". */
export function countryFlag(iso: string): string {
  return iso
    .toUpperCase()
    .replace(/[A-Z]/g, (letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** Localized country name ("Haïti"), falling back to the ISO code. */
export function countryName(iso: string, locale?: string): string {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

const digitsOf = (value: unknown): string =>
  value == null ? '' : String(value).replace(/\D/g, '');

/**
 * Canonical "+50937473889", or '' when there is no usable number.
 * A number already starting with "+" or "00" keeps its own country code.
 * With `dial`, any other number is a national number of that country (a trunk 0 dropped).
 * Without it, the stored-value rule of customer.phone_e164 in the database applies: 8 digits
 * is a Haitian number, anything longer already carries its country code ("50937473889").
 */
export function toE164(raw?: string | number | null, dial?: string): string {
  const text = raw == null ? '' : String(raw).trim();
  const digits = digitsOf(text);
  if (digits.length < MIN_PHONE_DIGITS) {
    return '';
  }
  if (text.startsWith('+')) {
    return `+${digits}`;
  }
  if (digits.startsWith('00')) {
    return `+${digits.slice(2)}`;
  }
  if (dial) {
    return `+${digitsOf(dial)}${digits.replace(/^0+/, '')}`;
  }
  return digits.length === 8 ? `+${DEFAULT_PHONE_DIAL}${digits}` : `+${digits}`;
}

/** Same phone once both are canonical, whatever the formatting. */
export function samePhone(a?: string | number | null, b?: string | number | null): boolean {
  const left = toE164(a);
  return Boolean(left) && left === toE164(b);
}

/**
 * Country and national digits of a stored phone, for editing it.
 * Without a country code the number is read as `fallbackIso`'s.
 * Several countries share +1: the preferred ISO wins when its code matches.
 */
export function splitPhone(
  stored?: string | number | null,
  fallbackIso: string = DEFAULT_PHONE_COUNTRY,
  preferredIso?: string,
): { country: PhoneCountry; national: string } {
  const text = stored == null ? '' : String(stored).trim();
  const fallback = findPhoneCountry(fallbackIso);
  if (!text) {
    return { country: fallback, national: '' };
  }
  // Stored without a country code: the database rule decides ("37473889" is Haitian).
  const e164 = toE164(text);
  if (!e164) {
    return { country: fallback, national: digitsOf(text).replace(/^0+/, '') };
  }

  const digits = e164.slice(1);
  const preferred = preferredIso ? findPhoneCountry(preferredIso) : undefined;
  if (preferred && digits.startsWith(preferred.dial)) {
    return { country: preferred, national: digits.slice(preferred.dial.length) };
  }
  // Longest calling code first: "+590…" is Guadeloupe, not a "+59" country.
  const match = [...PHONE_COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((country) => digits.startsWith(country.dial));
  if (!match) {
    return { country: fallback, national: digits };
  }
  // +1 is shared: keep the first listed country (the pinned ones come first).
  const country = PHONE_COUNTRIES.find((item) => item.dial === match.dial) ?? match;
  return { country, national: digits.slice(country.dial.length) };
}

/** Readable national part: "3747 3889", "305 555 1212", "6 12 34 56 78". */
function groupNational(national: string, dial: string): string {
  if (dial === '1' && national.length === 10) {
    return `${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  }
  if (dial === '33' && national.length === 9) {
    return [national.slice(0, 1), ...(national.slice(1).match(/.{1,2}/g) ?? [])].join(' ');
  }
  if (national.length === 8) {
    return `${national.slice(0, 4)} ${national.slice(4)}`;
  }
  const head = national.length % 3 || 3;
  return [national.slice(0, head), ...(national.slice(head).match(/.{1,3}/g) ?? [])].join(' ');
}

/**
 * Stored form "+509 3747 3889", or '' without a usable number: the national part alone
 * needs MIN_PHONE_DIGITS, so "+509 457" is not a phone.
 */
export function formatPhone(dial: string, national: string): string {
  const code = digitsOf(dial);
  const digits = digitsOf(national).replace(/^0+/, '');
  if (!code || digits.length < MIN_PHONE_DIGITS) {
    return '';
  }
  return `+${code} ${groupNational(digits, code)}`;
}

/** Any stored phone, displayed international: "37473889" → "+509 3747 3889". */
export function displayPhone(stored?: string | number | null): string {
  const text = stored == null ? '' : String(stored).trim();
  if (!text) {
    return '';
  }
  if (!toE164(text)) {
    return text;
  }
  const { country, national } = splitPhone(text);
  return formatPhone(country.dial, national) || text;
}

/** "+509 •••• 3889": a phone shown to tell two homonyms apart without reading it out. */
export function maskPhone(stored?: string | number | null): string {
  const e164 = toE164(stored);
  if (!e164) {
    return '';
  }
  const { country, national } = splitPhone(e164);
  return `+${country.dial} •••• ${national.slice(-4)}`;
}

/**
 * Full international display when the viewer may see phones; otherwise the masked form.
 * Search still uses the stored number — only what is shown changes.
 */
export function visiblePhone(
  stored?: string | number | null,
  canViewFull = false,
): string {
  return canViewFull ? displayPhone(stored) : maskPhone(stored);
}

/**
 * A number typed only to get past the "phone required" rule: one or two digits repeated
 * ("0000 0000", "2121 2121") or a straight run ("1234 5678"). Read on the national part.
 */
export function isPlaceholderPhone(stored?: string | number | null): boolean {
  const { national } = splitPhone(stored);
  if (national.length < MIN_PHONE_DIGITS) {
    return false;
  }
  return (
    new Set(national).size <= 2 ||
    '01234567890123456789'.includes(national) ||
    '98765432109876543210'.includes(national)
  );
}
