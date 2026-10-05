import { describe, expect, it } from 'vitest';
import { formatTableLabel } from '@/lib/table-label.ts';

const room = { name: 'R', number: '20', source: 'asi-room' };

describe('formatTableLabel', () => {
  it('reads a hotel room CH in French and R in other languages', () => {
    expect(formatTableLabel(room, 'fr')).toBe('CH20');
    expect(formatTableLabel(room, 'fr-CA')).toBe('CH20');
    expect(formatTableLabel(room, 'en')).toBe('R20');
    expect(formatTableLabel(room, 'es')).toBe('R20');
  });

  it('keeps a dining table as stored in every language', () => {
    expect(formatTableLabel({ name: 'T', number: '20', source: 'asi' }, 'fr')).toBe('T20');
    expect(formatTableLabel({ name: 'R', number: '20' }, 'fr')).toBe('R20');
  });

  it('is empty without a table', () => {
    expect(formatTableLabel(null, 'fr')).toBe('');
  });
});
