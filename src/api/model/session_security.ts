export const SESSION_SECURITY_KEY = 'session_security';

/** Dispatched after session security settings are saved so the idle provider reloads immediately. */
export const SESSION_SECURITY_CHANGED_EVENT = 'posr:session-security-changed';

/** Smallest allowed idle timeout (0.1 minutes = 6 seconds). */
export const MIN_IDLE_MINUTES = 0.1;

export type SessionSecurityAction = 'lock' | 'logout';

export interface SessionSecuritySettings {
  enabled: boolean;
  /** Idle timeout in minutes; fractional values allowed (e.g. 0.1 ≈ 6 seconds). */
  idle_minutes: number;
  /** Idle enforcement action. Prefer `idle_action`; `action` kept for older rows. */
  idle_action: SessionSecurityAction;
  /** @deprecated Use idle_action */
  action?: SessionSecurityAction;
}

/** On for every user without their own row: idle sign-out, resumable by the same user. */
export const DEFAULT_SESSION_SECURITY: SessionSecuritySettings = {
  enabled: true,
  idle_minutes: 15,
  idle_action: 'logout',
};

export const normalizeSessionAction = (value: unknown): SessionSecurityAction =>
  value === 'logout' || value === 'lock' ? value : DEFAULT_SESSION_SECURITY.idle_action;

export const normalizeIdleMinutes = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_SECURITY.idle_minutes;
  }
  // Keep up to 2 decimal places (e.g. 0.1 ≈ 6s, 0.25 = 15s)
  const rounded = Math.round(parsed * 100) / 100;
  return Math.max(MIN_IDLE_MINUTES, rounded);
};

export const normalizeSessionSecurity = (
  values?: Partial<SessionSecuritySettings> | null
): SessionSecuritySettings => {
  const raw = values ?? {};
  return {
    enabled: raw.enabled === undefined ? DEFAULT_SESSION_SECURITY.enabled : Boolean(raw.enabled),
    idle_minutes: normalizeIdleMinutes(raw.idle_minutes),
    idle_action: normalizeSessionAction(raw.idle_action ?? raw.action),
  };
};
