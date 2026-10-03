import { describe, expect, it } from 'vitest';
import { usesPosKeyboard } from '@/components/common/input/keyboard-mode.ts';

const TEXT_LIKE = [undefined, 'text', 'search', 'email', 'tel', 'password', 'number'] as const;
const EXCLUDED = [
  'checkbox',
  'radio',
  'file',
  'hidden',
  'color',
  'range',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
] as const;

describe('usesPosKeyboard', () => {
  it('returns false when touch is off', () => {
    for (const type of TEXT_LIKE) {
      expect(usesPosKeyboard(false, type, undefined)).toBe(false);
      expect(usesPosKeyboard(undefined, type, true)).toBe(false);
    }
  });

  it('returns true in touch mode for text-like types', () => {
    for (const type of TEXT_LIKE) {
      expect(usesPosKeyboard(true, type, undefined)).toBe(true);
      expect(usesPosKeyboard(true, type, true)).toBe(true);
    }
  });

  it('returns false when enableKeyboard is false', () => {
    expect(usesPosKeyboard(true, 'text', false)).toBe(false);
    expect(usesPosKeyboard(true, undefined, false)).toBe(false);
    expect(usesPosKeyboard(true, 'number', false)).toBe(false);
  });

  it('returns false for excluded non-text types in touch mode', () => {
    for (const type of EXCLUDED) {
      expect(usesPosKeyboard(true, type, undefined)).toBe(false);
      expect(usesPosKeyboard(true, type, true)).toBe(false);
    }
  });
});
