import { NavigateFunction } from 'react-router';
import { AppPageInterface } from '@/store/jotai.ts';
import { LOGIN } from '@/routes/posr.ts';
import {
  clearSessionTokens,
  gatewayLogout,
  isGatewayAuthEnabled,
} from '@/lib/session.ts';
import { saveResumePoint } from '@/lib/session-resume.ts';

type SetAppPage = (
  updater: AppPageInterface | ((prev: AppPageInterface) => AppPageInterface)
) => void;

const SESSION_EVENT = 'posr-session';

const currentPath = (): string =>
  typeof window === 'undefined' ? '' : `${window.location.pathname}${window.location.search}`;

export interface LogoutOptions {
  /** Let the same user pick up on this screen after signing back in (idle timeout). */
  resume?: boolean;
}

async function clearGatewaySession(): Promise<void> {
  if (!isGatewayAuthEnabled()) {
    return;
  }
  await gatewayLogout();
  clearSessionTokens();
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export const logoutSession = async (
  setPage: SetAppPage,
  navigate: NavigateFunction,
  { resume = false }: LogoutOptions = {}
): Promise<void> => {
  // Capture before the async gateway call: navigation or a re-render may move us.
  const path = resume ? currentPath() : null;
  await clearGatewaySession();

  setPage((prev) => {
    const user = prev.user ?? prev.lockedBy;
    if (user?.id != null) {
      saveResumePoint(user.id, path);
    }
    return {
      ...prev,
      page: 'Login',
      user: undefined,
      locked: false,
      lockedBy: undefined,
    };
  });
  navigate(LOGIN);
};

export const lockSession = (setPage: SetAppPage, navigate: NavigateFunction) => {
  const path = currentPath();
  setPage((prev) => {
    const lockedBy = prev.user ?? prev.lockedBy;
    if (lockedBy?.id != null && !prev.locked) {
      saveResumePoint(lockedBy.id, path);
    }
    return {
      ...prev,
      page: 'Login',
      // Keep the user on the session so unlock + lock banner work like the sidebar lock.
      user: lockedBy,
      locked: true,
      lockedBy,
    };
  });
  navigate(LOGIN);
};
