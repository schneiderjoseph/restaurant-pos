import type { AppStateInterface } from '@/store/jotai.ts';
import { clearSessionTokens, gatewayLogout, getSessionToken } from '@/lib/session.ts';
import { clearResumePoint } from '@/lib/session-resume.ts';

/**
 * The POS session lives in localStorage (multi-tab), which outlives the browser.
 * A sessionStorage marker tells a reload of a live tab apart from a brand-new tab;
 * a brand-new tab then asks the other POS tabs whether any is still open. Nobody
 * answering means the browser was closed, so the stored session is ended.
 */
const TAB_MARKER_KEY = 'posr_tab_session';
const PRESENCE_CHANNEL = 'posr-browser-session';
const PROBE = 'probe';
const ALIVE = 'alive';
const PROBE_TIMEOUT_MS = 500;

const APP_PAGE_KEY = 'app-page';
const APP_STATE_KEY = 'app-state';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** In-progress order selection — must not carry over to another user or a new browser session. */
export const clearedOrderSelection: Partial<AppStateInterface> = {
  orderType: undefined,
  showFloor: true,
  showPersons: false,
  persons: '1',
  dueAt: undefined,
  cart: [],
  order: undefined,
  orders: [],
  customer: undefined,
  table: undefined,
  seats: [],
  seat: undefined,
  switchTable: false,
};

const updateJson = (
  storage: KeyValueStorage,
  key: string,
  update: (value: Record<string, unknown>) => Record<string, unknown>,
) => {
  const raw = storage.getItem(key);
  if (!raw) return;
  try {
    storage.setItem(key, JSON.stringify(update(JSON.parse(raw) as Record<string, unknown>)));
  } catch {
    storage.removeItem(key);
  }
};

/** Signed-in user, lock and order selection go; device preferences (language, menu config, filters) stay. */
export const stripPersistedSession = (storage: KeyValueStorage): void => {
  updateJson(storage, APP_PAGE_KEY, (page) => {
    const { user: _user, locked: _locked, lockedBy: _lockedBy, ...rest } = page;
    return { ...rest, page: 'Login' };
  });
  updateJson(storage, APP_STATE_KEY, (state) => ({ ...state, ...clearedOrderSelection }));
  clearResumePoint(storage);
};

const hasPersistedSession = (storage: KeyValueStorage): boolean => {
  if (getSessionToken()) return true;
  try {
    const page = JSON.parse(storage.getItem(APP_PAGE_KEY) || '{}') as { user?: unknown };
    return page?.user != null;
  } catch {
    return false;
  }
};

const probeOtherTabs = (): Promise<boolean> =>
  new Promise((resolve) => {
    if (typeof BroadcastChannel === 'undefined') {
      resolve(false);
      return;
    }
    const channel = new BroadcastChannel(PRESENCE_CHANNEL);
    const timer = window.setTimeout(() => {
      channel.close();
      resolve(false);
    }, PROBE_TIMEOUT_MS);
    channel.onmessage = (event) => {
      if (event.data !== ALIVE) return;
      window.clearTimeout(timer);
      channel.close();
      resolve(true);
    };
    channel.postMessage(PROBE);
  });

/** Answer probes from tabs opened later, for as long as this tab lives. */
const announcePresence = () => {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(PRESENCE_CHANNEL);
  channel.onmessage = (event) => {
    if (event.data === PROBE) channel.postMessage(ALIVE);
  };
};

/** Run once before the app renders, so persisted atoms initialise from the cleaned storage. */
export async function resolveBrowserSession(): Promise<void> {
  try {
    const reloadOfLiveTab = sessionStorage.getItem(TAB_MARKER_KEY) === '1';
    if (!reloadOfLiveTab && hasPersistedSession(localStorage) && !(await probeOtherTabs())) {
      // Revoke server-side first: gatewayLogout reads the token synchronously.
      void gatewayLogout();
      clearSessionTokens();
      stripPersistedSession(localStorage);
    }
    sessionStorage.setItem(TAB_MARKER_KEY, '1');
  } catch {
    // Storage blocked (private mode policies) — nothing persisted to end.
  }
  announcePresence();
}
