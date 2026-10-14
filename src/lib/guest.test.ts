import { describe, expect, it } from 'vitest';
import { RecordId } from 'surrealdb';
import { asiOccupantForGuestRooms, orderRoomOf, reportsAsWalkIn } from '@/lib/guest.ts';

describe('asiOccupantForGuestRooms', () => {
  const asi = { id: 'customer:asi_fd_1', source: 'asi-fd' as const, name: 'Matchalie', guest_code: null };
  const occupancy = new Map([['32', asi]]);

  it('finds the ASI guest when a manual stay still shows that room', () => {
    expect(asiOccupantForGuestRooms(
      { id: 'customer:pablo', source: 'walk-in', room: '32' },
      occupancy,
    )).toEqual(asi);
  });

  it('ignores ASI guests and rooms ASI does not hold', () => {
    expect(asiOccupantForGuestRooms(asi, occupancy)).toBeUndefined();
    expect(asiOccupantForGuestRooms(
      { id: 'customer:pablo', source: 'walk-in', room: '14' },
      occupancy,
    )).toBeUndefined();
  });
});

describe('orderRoomOf', () => {
  it('sends an ASI guest to their room', () => {
    expect(orderRoomOf({ source: 'asi-fd', room: ' 21 ' })).toBe('21');
  });

  it('never makes a room order of a Front Desk stay or a walk-in', () => {
    expect(orderRoomOf({ source: 'walk-in', room: '14' })).toBe('');
    expect(orderRoomOf({ source: 'local', room: '14' })).toBe('');
    expect(orderRoomOf(null)).toBe('');
  });
});

describe('reportsAsWalkIn', () => {
  const room = { source: 'asi-room', number: '14' };

  it('counts a Front Desk stay on a room table as a walk-in', () => {
    expect(reportsAsWalkIn({ table: room, customer: { source: 'walk-in', room: '14' } })).toBe(true);
  });

  it('keeps an ASI guest and a dining table as they are', () => {
    expect(reportsAsWalkIn({ table: room, customer: { source: 'asi-fd', room: '14' } })).toBe(false);
    expect(reportsAsWalkIn({ table: { source: 'manual', number: '7' }, customer: { source: 'walk-in' } })).toBe(false);
  });

  it('keeps the room when the customer was not fetched', () => {
    expect(reportsAsWalkIn({ table: room, customer: new RecordId('customer', 'x') })).toBe(false);
    expect(reportsAsWalkIn({ table: room })).toBe(false);
  });
});
