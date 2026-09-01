import { describe, expect, it } from 'vitest';
import {
  formatKitchenGuestLabel,
  formatKitchenPlaceLabel,
  truncateGuestName,
} from '@/lib/kitchen-ticket-label.ts';

describe('truncateGuestName', () => {
  it('keeps short names', () => {
    expect(truncateGuestName('Jean')).toBe('Jean');
  });

  it('shortens long multi-word names', () => {
    expect(truncateGuestName('Ricardo Michel Jean')).toMatch(/^Ricardo /);
  });
});

describe('formatKitchenGuestLabel', () => {
  const guest = { name: 'Ricardo Michel', guest_code: 'RICM482' };

  it('prefers name by default', () => {
    expect(formatKitchenGuestLabel(guest, 'name')).toBe('Ricardo Michel');
  });

  it('can show code only', () => {
    expect(formatKitchenGuestLabel(guest, 'code')).toBe('#RICM482');
  });

  it('can show both', () => {
    expect(formatKitchenGuestLabel(guest, 'both')).toBe('Ricardo Michel · #RICM482');
  });

  it('falls back when one side is missing', () => {
    expect(formatKitchenGuestLabel({ name: '', guest_code: 'ABC' }, 'name')).toBe('#ABC');
    expect(formatKitchenGuestLabel({ name: 'Paul', guest_code: '' }, 'code')).toBe('Paul');
  });
});

describe('formatKitchenPlaceLabel', () => {
  const labels = { room: 'Chambre', table: 'Table' };

  it('labels hotel rooms as Chambre', () => {
    expect(
      formatKitchenPlaceLabel({ source: 'asi-room', number: '18', name: 'Room' }, labels),
    ).toBe('Chambre 18');
  });

  it('labels dining tables as Table', () => {
    expect(
      formatKitchenPlaceLabel({ source: 'asi', number: '7', name: 'Table' }, labels),
    ).toBe('Table 7');
  });
});
