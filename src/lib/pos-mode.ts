export type PosMode = 'native' | 'asi' | 'loyverse';

/** POS profile: native (local), asi (SQL menu + PMS), or loyverse (cloud catalogue + optional PMS rooms). */
export function getPosMode(): PosMode {
  const raw = String(import.meta.env.VITE_POS_MODE ?? 'native').toLowerCase().trim();
  if (raw === 'asi') return 'asi';
  if (raw === 'loyverse') return 'loyverse';
  return 'native';
}

export function isAsiMode(): boolean {
  return getPosMode() === 'asi';
}

export function isLoyverseMode(): boolean {
  return getPosMode() === 'loyverse';
}

/** External catalogue mode (ASI or Loyverse) — hide PLU badges etc. */
export function isExternalCatalogueMode(): boolean {
  const mode = getPosMode();
  return mode === 'asi' || mode === 'loyverse';
}

/**
 * Hotel rooms / in-house guests from ASI FrontDesk (PMS).
 * - ASI mode: full PMS + menu from ASI
 * - Loyverse mode + resort: PMS rooms only (menu stays Loyverse — never ASI catalogue)
 */
export function usesAsiPmsRooms(): boolean {
  if (isAsiMode()) return true;
  return isLoyverseMode() && isResortFbEnabled();
}

/** Resort F&B UI (guest lookup + salle floor). Additive — does not hide other features. */
export function isResortFbEnabled(): boolean {
  const raw = String(import.meta.env.VITE_RESORT_FB ?? 'false').toLowerCase().trim();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}
