import {useEffect, useRef} from "react";
import {useAtom, useSetAtom} from "jotai";
import {useNavigate} from "react-router";
import {useTranslation} from "react-i18next";
import {appAlert, appPage} from "@/store/jotai.ts";
import {
  checkGatewaySession,
  getSessionToken,
  isGatewayAuthEnabled,
  isLocalLogoutInProgress,
} from "@/lib/session.ts";
import {logoutSession} from "@/lib/session.actions.ts";

const CHECK_INTERVAL_MS = 10_000;

/**
 * One user, one tablet: when the signed-in user logs in on another device, the gateway
 * revokes this device's session and cuts its database socket. This notices it, tells the
 * user why, and returns to the login screen.
 */
export const SessionReplacedWatcher = () => {
  const {t} = useTranslation('auth');
  const [page, setPage] = useAtom(appPage);
  const setAlert = useSetAtom(appAlert);
  const navigate = useNavigate();
  const signedIn = Boolean(page.user || page.lockedBy);
  // The token this device last held: the database layer clears it when the socket is cut.
  const lastTokenRef = useRef<string | null>(null);
  const handlingRef = useRef(false);

  useEffect(() => {
    if (!isGatewayAuthEnabled() || !signedIn) {
      lastTokenRef.current = null;
      return;
    }

    let cancelled = false;

    const check = async () => {
      const token = getSessionToken() ?? lastTokenRef.current;
      if (!token || handlingRef.current) {
        return;
      }
      lastTokenRef.current = token;
      const state = await checkGatewaySession(token);
      if (cancelled || state !== 'replaced' || isLocalLogoutInProgress()) {
        return;
      }
      handlingRef.current = true;
      try {
        setAlert({opened: true, type: 'warning', message: t('session.replaced')});
        await logoutSession(setPage, navigate);
      } finally {
        handlingRef.current = false;
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void check();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signedIn, setAlert, setPage, navigate, t]);

  return null;
};
