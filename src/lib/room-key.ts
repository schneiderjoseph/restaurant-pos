/**
 * Normalize a hotel room number / alias for comparison and unique stay keys.
 * Same rules as the floor layout map (number strings collapse leading zeros).
 */
export const normalizeRoomKey = (raw?: string | number | null): string => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^\d+$/.test(trimmed)) {
    return String(Number(trimmed));
  }
  return trimmed.toLowerCase();
};

/** Candidate strings that may appear on customer.room or floor_table.number / asi_alias. */
export const roomKeyCandidates = (raw?: string | number | null): string[] => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  const key = normalizeRoomKey(trimmed);
  return Array.from(new Set([trimmed, key, trimmed.replace(/^0+/, '') || trimmed].filter(Boolean)));
};

/** Every room token on customer.room (one room, or "12, 14" for multi-room Front Desk stays). */
export const splitGuestRooms = (room?: string | number | null): string[] =>
  String(room ?? '')
    .split(/[,;/|]+/)
    .map((part) => part.trim())
    .filter(Boolean);

/** Display string for every open room on a guest ("12, 14"). */
export const joinGuestRooms = (rooms: Array<string | null | undefined>): string => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of rooms) {
    const value = String(raw ?? '').trim();
    if (!value) continue;
    const key = normalizeRoomKey(value) || value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(value);
  }
  return ordered.join(', ');
};
