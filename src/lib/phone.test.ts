import { describe, expect, it } from 'vitest';
import {
  displayPhone,
  formatPhone,
  maskPhone,
  PHONE_COUNTRIES,
  samePhone,
  splitPhone,
  toE164,
  visiblePhone,
} from '@/lib/phone.ts';

describe('toE164', () => {
  it('reads a number without country code as Haitian by default', () => {
    expect(toE164('3747-3889')).toBe('+50937473889');
    expect(toE164('3747 3889')).toBe('+50937473889');
  });

  it('keeps an explicit country code', () => {
    expect(toE164('+509 3747 3889')).toBe('+50937473889');
    expect(toE164('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(toE164('0033612345678')).toBe('+33612345678');
    expect(toE164(50937473889)).toBe('+50937473889');
  });

  it('applies the chosen country and drops a trunk 0', () => {
    expect(toE164('06 12 34 56 78', '33')).toBe('+33612345678');
    expect(toE164('305 555 1212', '1')).toBe('+13055551212');
  });

  it('rejects numbers too short to be a phone', () => {
    expect(toE164('457')).toBe('');
    expect(toE164('')).toBe('');
    expect(toE164(null)).toBe('');
  });
});

describe('samePhone', () => {
  it('compares the canonical forms', () => {
    expect(samePhone('3747-3889', '+509 3747 3889')).toBe(true);
    expect(samePhone('3747-3889', '+509 3747 3880')).toBe(false);
    // Same last digits, different country: not the same phone.
    expect(samePhone('+33 6 37 47 38 89', '+509 3747 3889')).toBe(false);
    expect(samePhone('', '')).toBe(false);
  });
});

describe('splitPhone', () => {
  it('finds the country of an international number', () => {
    expect(splitPhone('+509 3747 3889')).toMatchObject({ country: { iso: 'HT' }, national: '37473889' });
    expect(splitPhone('+33612345678')).toMatchObject({ country: { iso: 'FR' }, national: '612345678' });
    // Longest code wins: +590 is Guadeloupe.
    expect(splitPhone('+590690123456')).toMatchObject({ country: { iso: 'GP' }, national: '690123456' });
  });

  it('reads a national number with the fallback country', () => {
    expect(splitPhone('3747-3889')).toMatchObject({ country: { iso: 'HT' }, national: '37473889' });
    expect(splitPhone('')).toMatchObject({ country: { iso: 'HT' }, national: '' });
  });

  it('keeps the preferred country among those sharing +1', () => {
    expect(splitPhone('+1 305 555 1212').country.iso).toBe('DO');
    expect(splitPhone('+1 305 555 1212', 'HT', 'US').country.iso).toBe('US');
  });
});

describe('formatPhone / displayPhone / maskPhone', () => {
  it('formats the stored international form', () => {
    expect(formatPhone('509', '37473889')).toBe('+509 3747 3889');
    expect(formatPhone('1', '3055551212')).toBe('+1 305 555 1212');
    expect(formatPhone('33', '0612345678')).toBe('+33 6 12 34 56 78');
    expect(formatPhone('509', '457')).toBe('');
  });

  it('displays any stored phone internationally', () => {
    expect(displayPhone('37473889')).toBe('+509 3747 3889');
    expect(displayPhone('457')).toBe('457');
    expect(displayPhone(undefined)).toBe('');
  });

  it('masks all but the last four digits', () => {
    expect(maskPhone('+509 3747 3889')).toBe('+509 •••• 3889');
    expect(maskPhone('12')).toBe('');
  });

  it('shows full or masked phone from the view right', () => {
    expect(visiblePhone('+509 3747 3889', true)).toBe('+509 3747 3889');
    expect(visiblePhone('+509 3747 3889', false)).toBe('+509 •••• 3889');
  });
});

describe('PHONE_COUNTRIES', () => {
  it('starts with Haiti and has no duplicate ISO code', () => {
    expect(PHONE_COUNTRIES[0].iso).toBe('HT');
    const isos = PHONE_COUNTRIES.map((country) => country.iso);
    expect(new Set(isos).size).toBe(isos.length);
  });
});
