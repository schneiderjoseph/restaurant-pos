import { describe, expect, it } from 'vitest';
import { formatGuestContact, formatGuestLabel, formatPersonName } from '@/lib/guest-label.ts';

describe('formatGuestLabel', () => {
  it('prefers name over guest_code', () => {
    expect(formatGuestLabel({ name: 'Alice', guest_code: 'G123' })).toBe('Alice');
  });

  it('falls back to #CODE when name is empty', () => {
    expect(formatGuestLabel({ name: '  ', guest_code: 'G123' })).toBe('#G123');
    expect(formatGuestLabel({ guest_code: '#AB' })).toBe('#AB');
    expect(formatGuestLabel({ code: 'X1' })).toBe('#X1');
  });

  it('returns empty for nullish guest', () => {
    expect(formatGuestLabel(null)).toBe('');
    expect(formatGuestLabel(undefined)).toBe('');
    expect(formatGuestLabel({})).toBe('');
  });
});

describe('formatGuestContact', () => {
  it('prefers phone', () => {
    expect(formatGuestContact({
      name: 'Jean Dupont',
      phone: '+509 3412 0000',
      guest_code: 'R204',
      id_document_number: '0034567890',
    })).toBe('+509 3412 0000');
  });

  it('falls back to #guest_code only when guest has a name', () => {
    expect(formatGuestContact({ name: 'Jean', guest_code: 'R204' })).toBe('#R204');
    expect(formatGuestContact({ guest_code: 'R204' })).toBe('');
  });

  it('falls back to masked ID document', () => {
    expect(formatGuestContact({
      name: 'Jean',
      id_document_number: '003-456-789-0',
    })).toBe('••••7890');
  });

  it('returns empty when contact would repeat the label', () => {
    expect(formatGuestContact({ guest_code: 'R204' })).toBe('');
    expect(formatGuestContact({ name: 'Alice', phone: 'Alice' })).toBe('');
  });

  it('returns empty for nullish guest', () => {
    expect(formatGuestContact(null)).toBe('');
    expect(formatGuestContact(undefined)).toBe('');
    expect(formatGuestContact({})).toBe('');
  });
});

describe('formatPersonName', () => {
  it('capitalizes each word whatever the typing', () => {
    expect(formatPersonName('  JHON   CartEr XxXy ')).toBe('Jhon Carter Xxxy');
    expect(formatPersonName('jean-pierre o\'brien')).toBe('Jean-Pierre O\'Brien');
    expect(formatPersonName('ÉLODIE DUPONT')).toBe('Élodie Dupont');
    expect(formatPersonName(null)).toBe('');
  });

  it('is used for the guest label', () => {
    expect(formatGuestLabel({ name: 'mARIE pierre' })).toBe('Marie Pierre');
  });
});
