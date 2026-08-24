export type PosMode = 'native' | 'asi';

/** POS profile: native (local menu/guests) or asi (SQL menu + PMS guests). */
export function getPosMode(): PosMode {
  const raw = String(import.meta.env.VITE_POS_MODE ?? 'native').toLowerCase().trim();
  return raw === 'asi' ? 'asi' : 'native';
}

export function isAsiMode(): boolean {
  return getPosMode() === 'asi';
}

/** Resort F&B UI (guest lookup + salle floor). Additive — does not hide other features. */
export function isResortFbEnabled(): boolean {
  const raw = String(import.meta.env.VITE_RESORT_FB ?? 'false').toLowerCase().trim();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}
