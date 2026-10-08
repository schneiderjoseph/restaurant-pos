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
