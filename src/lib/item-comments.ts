/**
 * Cart-line comment helpers: toggle kitchen shorthand presets and a trailing
 * "POUR HH:mm" segment (same wording as the order-level due header on tickets).
 */

export const ITEM_COMMENT_SEPARATOR = ', ';

/** Stable ids for the built-in quick comments. Labels come from i18n. */
export type ItemCommentPresetId =
  | 'noSalt'
  | 'noSugar'
  | 'noOnion'
  | 'noGarlic'
  | 'noSpice'
  | 'noSauce'
  | 'sauceOnSide'
  | 'extraSauce'
  | 'noButter'
  | 'noCheese'
  | 'rare'
  | 'medium'
  | 'wellDone'
  | 'allergy'
  | 'immediate';

export const ITEM_COMMENT_PRESET_IDS: ItemCommentPresetId[] = [
  'noSalt',
  'noSugar',
  'noOnion',
  'noGarlic',
  'noSpice',
  'noSauce',
  'sauceOnSide',
  'extraSauce',
  'noButter',
  'noCheese',
  'rare',
  'medium',
  'wellDone',
  'allergy',
  'immediate',
];

const DEFAULT_POUR_PREFIX = 'POUR';

function pourPartPattern(prefix: string): RegExp {
  const escaped = prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || DEFAULT_POUR_PREFIX;
  return new RegExp(`^${escaped}\\s+.+`, 'i');
}

export function splitItemComments(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  return text
    .split(/,\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function joinItemComments(parts: string[]): string {
  return parts.map((p) => p.trim()).filter(Boolean).join(ITEM_COMMENT_SEPARATOR);
}

export function isPourCommentPart(part: string, pourPrefix = DEFAULT_POUR_PREFIX): boolean {
  return pourPartPattern(pourPrefix).test(part.trim());
}

export function hasItemCommentPreset(
  comments: string | null | undefined,
  presetLabel: string,
): boolean {
  const needle = presetLabel.trim().toLowerCase();
  if (!needle) return false;
  return splitItemComments(comments).some((p) => p.toLowerCase() === needle);
}

/**
 * Add or remove a preset label. Turning on "immediate" clears any POUR segment;
 * adding POUR is handled separately and clears "immediate".
 */
export function toggleItemCommentPreset(
  comments: string | null | undefined,
  presetLabel: string,
  options?: { clearsPour?: boolean; pourPrefix?: string },
): string {
  const label = presetLabel.trim();
  if (!label) return comments?.trim() ?? '';

  const prefix = options?.pourPrefix ?? DEFAULT_POUR_PREFIX;
  const parts = splitItemComments(comments);
  const idx = parts.findIndex((p) => p.toLowerCase() === label.toLowerCase());
  if (idx >= 0) {
    parts.splice(idx, 1);
  } else {
    parts.push(label);
    if (options?.clearsPour) {
      for (let i = parts.length - 1; i >= 0; i--) {
        if (isPourCommentPart(parts[i], prefix)) parts.splice(i, 1);
      }
    }
  }
  return joinItemComments(parts);
}

/** Read the label after POUR (e.g. "19:30" or "06/10 08:00"), or null. */
export function getItemPourLabel(
  comments: string | null | undefined,
  pourPrefix = DEFAULT_POUR_PREFIX,
): string | null {
  const part = splitItemComments(comments).find((p) => isPourCommentPart(p, pourPrefix));
  if (!part) return null;
  const escaped = pourPrefix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || DEFAULT_POUR_PREFIX;
  return part.replace(new RegExp(`^${escaped}\\s+`, 'i'), '').trim() || null;
}

/**
 * Set or clear the POUR segment. When setting a time, remove any "immediate"
 * preset whose label matches `immediateLabel` (case-insensitive).
 */
export function setItemPourComment(
  comments: string | null | undefined,
  dueLabel: string | null,
  options?: { immediateLabel?: string; pourPrefix?: string },
): string {
  const prefix = (options?.pourPrefix ?? DEFAULT_POUR_PREFIX).trim() || DEFAULT_POUR_PREFIX;
  const immediate = options?.immediateLabel?.trim().toLowerCase();
  let parts = splitItemComments(comments).filter((p) => !isPourCommentPart(p, prefix));

  if (dueLabel?.trim()) {
    if (immediate) {
      parts = parts.filter((p) => p.toLowerCase() !== immediate);
    }
    parts.push(`${prefix} ${dueLabel.trim()}`);
  }

  return joinItemComments(parts);
}

/**
 * Best-effort parse of a POUR label into today/tomorrow hour+minute for the
 * due picker. Returns null when the label is not a simple wall-clock time.
 */
export function parseItemPourParts(
  dueLabel: string | null | undefined,
): { dayOffset: number; hour: number; minute: number } | null {
  if (!dueLabel?.trim()) return null;
  const text = dueLabel.trim();

  const withDay = text.match(/^(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/);
  if (withDay) {
    return {
      dayOffset: 0,
      hour: Number(withDay[3]),
      minute: Number(withDay[4]),
    };
  }

  // Localized "tmr 08:00" / "dem. 08:00" — treat as tomorrow when a word precedes the time.
  const withWord = text.match(/^.+?\s+(\d{2}):(\d{2})$/);
  if (withWord && !/^\d{2}:\d{2}$/.test(text)) {
    return {
      dayOffset: 1,
      hour: Number(withWord[1]),
      minute: Number(withWord[2]),
    };
  }

  const today = text.match(/^(\d{2}):(\d{2})$/);
  if (today) {
    return { dayOffset: 0, hour: Number(today[1]), minute: Number(today[2]) };
  }

  return null;
}
