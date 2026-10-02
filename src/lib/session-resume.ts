/**
 * Where a user was when their session ended (idle logout, lock, manual logout),
 * so the next sign-in can decide: same user → back to that screen, anyone else
 * → fresh menu with the previous user's in-progress order cleared.
 */
export const RESUME_POINT_KEY = 'posr_resume_point';

export interface ResumePoint {
  userId: string;
  /** Path + search to return to; null after a deliberate logout (start at the menu). */
  path: string | null;
}

export type ResumeDecision =
  | { kind: 'resume'; path: string }
  | { kind: 'menu' }
  | { kind: 'switch-user' };

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStorage = (): KeyValueStorage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Strip the SurrealDB table prefix so `user:abc` and `abc` compare equal. */
export const normalizeUserId = (id: unknown): string => {
  if (id == null) return '';
  const s = typeof id === 'string' ? id : String((id as { toString?: () => string }).toString?.() ?? id);
  return s.includes(':') ? s.slice(s.indexOf(':') + 1) : s;
};

/** Login, lock and idle screens never count as a place to come back to. */
const isResumablePath = (path: string | null | undefined): path is string =>
  typeof path === 'string' && path.startsWith('/') && path !== '/' && !path.startsWith('//');

export const saveResumePoint = (
  userId: unknown,
  path: string | null,
  storage: KeyValueStorage | null = defaultStorage(),
): void => {
  const id = normalizeUserId(userId);
  if (!storage || !id) return;
  const point: ResumePoint = { userId: id, path: isResumablePath(path) ? path : null };
  try {
    storage.setItem(RESUME_POINT_KEY, JSON.stringify(point));
  } catch {
    // ignore quota / private mode
  }
};

export const readResumePoint = (
  storage: KeyValueStorage | null = defaultStorage(),
): ResumePoint | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(RESUME_POINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ResumePoint>;
    const userId = normalizeUserId(parsed?.userId);
    if (!userId) return null;
    return { userId, path: isResumablePath(parsed.path) ? parsed.path : null };
  } catch {
    return null;
  }
};

export const clearResumePoint = (storage: KeyValueStorage | null = defaultStorage()): void => {
  try {
    storage?.removeItem(RESUME_POINT_KEY);
  } catch {
    // ignore
  }
};

/**
 * What to do once `userId` has signed in, given the previous session's resume point.
 * No point at all means a fresh browser session (or first login): start at the menu.
 */
export const decideResume = (point: ResumePoint | null, userId: unknown): ResumeDecision => {
  if (!point) return { kind: 'menu' };
  if (point.userId !== normalizeUserId(userId)) return { kind: 'switch-user' };
  return point.path ? { kind: 'resume', path: point.path } : { kind: 'menu' };
};
