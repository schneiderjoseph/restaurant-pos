import { describe, expect, it } from 'vitest';
import { normalizeRoomKey, roomKeyCandidates } from '@/lib/room-key.ts';

describe('normalizeRoomKey', () => {
  it('collapses numeric leading zeros', () => {
    expect(normalizeRoomKey('012')).toBe('12');
    expect(normalizeRoomKey(12)).toBe('12');
  });

  it('lowercases non-numeric aliases', () => {
    expect(normalizeRoomKey('Suite-A')).toBe('suite-a');
  });

  it('returns empty for blank', () => {
    expect(normalizeRoomKey('')).toBe('');
    expect(normalizeRoomKey(null)).toBe('');
  });
});

describe('roomKeyCandidates', () => {
  it('includes raw, normalized and stripped forms', () => {
    expect(roomKeyCandidates('012')).toEqual(expect.arrayContaining(['012', '12']));
  });
});
