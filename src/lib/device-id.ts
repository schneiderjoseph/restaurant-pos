const DEVICE_ID_KEY = 'posr_device_id';

const randomId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

/**
 * Stable id of this browser, sent at login so the gateway can tell a second tablet from
 * an unlock or a second tab on the same one (one active session per user).
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) {
      return existing;
    }
    const created = randomId();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return randomId();
  }
}
