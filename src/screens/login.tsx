import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBackspace, faCircle } from "@fortawesome/free-solid-svg-icons";
import {faCircle as circleRegular} from '@fortawesome/free-regular-svg-icons';
import {useEffect, useLayoutEffect, useState} from "react";
import { useAtom, useSetAtom } from "jotai";
import { appPage, appState } from "@/store/jotai.ts";
import { orderEditSessionAtom } from "@/store/order-edit-session.ts";
import { cn } from "@/lib/utils.ts";
import { useDB } from "@/api/db/db.ts";
import { useDatabase } from "@/hooks/useDatabase.ts";
import { User } from "@/api/model/user.ts";
import {useNavigate, useLocation} from "react-router";
import {MENU} from "@/routes/posr.ts";
import { Tables } from "@/api/db/tables.ts";
import { toast } from "sonner";
import { getUserModules } from "@/lib/access.rules.ts";
import { UserRole } from "@/api/model/user_role.ts";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { DocumentTitle } from "@/components/common/document-title.tsx";
import { PageLoader } from "@/components/common/loader/page-loader.tsx";
import { getStoredLoginLogo } from "@/lib/restaurant-profile.ts";
import {
  clearSessionTokens,
  gatewayLogin,
  getSessionToken,
  isGatewayAuthEnabled,
  isLoginServerFailure,
  revokeGatewayToken,
  setSessionTokens,
  type GatewayLoginResponse,
} from "@/lib/session.ts";
import { clearResumePoint, decideResume, readResumePoint } from "@/lib/session-resume.ts";
import { clearedOrderSelection } from "@/lib/browser-session.ts";

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

const formatRetryMinutes = (retryAfterMs?: number, lockoutMs?: number) => {
  const ms = retryAfterMs ?? lockoutMs ?? LOGIN_LOCKOUT_MINUTES * 60 * 1000;
  return Math.max(1, Math.ceil(ms / 60000));
};

export const Login = () => {
  const db = useDB();
  const { connect } = useDatabase();
  const { t } = useTranslation('auth');
  const { t: tCommon } = useTranslation('common');
  const gatewayAuth = isGatewayAuthEnabled();

  const [code, setCode] = useState('');
  // The logo this device kept from the profile, else the installation's own file
  // (public/branding/login-background.jpg, not in git); nothing shows when neither exists.
  const [loginLogo] = useState(() => getStoredLoginLogo() ?? '/branding/login-background.jpg');
  const [page, setPage] = useAtom(appPage);
  const setAppState = useSetAtom(appState);
  const setEditSession = useSetAtom(orderEditSessionAtom);
  const [error, setError] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const navigation = useNavigate();
  const location = useLocation();

  const onClear = () => {
    setCode('');
  }

  const onBack = () => {
    setCode(prev => prev.slice(0, prev.length - 1));
  }

  const onKey = (key: string) => {
    // Functional update: quick taps must not read a stale code.
    setCode(prev => (prev.trim().length <= 3 ? prev + key : prev));
  }

  const failConnection = () => {
    clearSessionTokens();
    toast.error(i18n.t('auth:login.connectionFailed', { defaultValue: 'Database connection failed after login' }));
    denyLogin();
  };

  const afterUserAuthenticated = async (normalizedUser: User) => {
    if (page.locked && page.lockedBy?.login !== normalizedUser.login) {
      denyLogin();
      return false;
    }

    allowLogin(normalizedUser);
    return true;
  };

  const getLockoutPolicyMessage = () => t('login.lockoutPolicy', {
    maxAttempts: LOGIN_MAX_ATTEMPTS,
    lockoutMinutes: LOGIN_LOCKOUT_MINUTES,
    defaultValue: `After ${LOGIN_MAX_ATTEMPTS} failed attempts, your account will be locked for ${LOGIN_LOCKOUT_MINUTES} minutes.`,
  });

  const showLoginFailureToast = (result?: GatewayLoginResponse) => {
    if (isLoginServerFailure(result?.status)) {
      toast.error(t('login.serverUnavailable', {
        defaultValue: 'Server unavailable — your PIN was not checked. Try again in a moment or call the manager.',
      }));
      return;
    }

    if (result?.status === 429 || result?.retryAfterMs != null) {
      const minutes = formatRetryMinutes(result.retryAfterMs, result.lockoutMs);
      const message = result.code === 'rate_limited_ip'
        ? t('login.rateLimitedIp', { minutes, defaultValue: `Too many login attempts. Try again in ${minutes} minute(s).` })
        : t('login.rateLimited', { minutes, defaultValue: `Too many login attempts. Try again in ${minutes} minute(s).` });
      toast.error(message);
      return;
    }

    const lockoutPolicy = gatewayAuth ? getLockoutPolicyMessage() : undefined;

    if (result?.attemptsRemaining != null && result.attemptsRemaining > 0) {
      toast.error(t('login.invalidCredentialsWithAttempts', {
        count: result.attemptsRemaining,
        defaultValue: `Invalid PIN. ${result.attemptsRemaining} attempt(s) remaining before lockout.`,
      }), { description: lockoutPolicy });
      return;
    }

    toast.error(t('login.invalidCredentials'), { description: lockoutPolicy });
  };

  const handleLoginFailure = (result?: GatewayLoginResponse) => {
    showLoginFailureToast(result);
    denyLogin();
  };

  const checkLoginGateway = async (pin: string) => {
    const result = await gatewayLogin({ method: 'pin', login: pin, password: pin });
    if (!result.ok || !result.token || !result.surrealToken || !result.user) {
      handleLoginFailure(result);
      return false;
    }

    // A locked screen only reopens for the user who locked it: refuse before this
    // tablet switches to the other user's tokens and database session.
    if (page.locked && page.lockedBy?.login !== (result.user as User).login) {
      void revokeGatewayToken(result.token);
      denyLogin();
      return false;
    }

    setSessionTokens(result.token, result.surrealToken);

    try {
      // Connect before announcing the session so Login stays mounted.
      await connect();
    } catch (err) {
      console.error(err);
      failConnection();
      return false;
    }

    const loggedInUser = result.user as User;
    const normalizedUser = {
      ...loggedInUser,
      roles: (loggedInUser as User & { roles?: string[] }).roles?.length
        ? (loggedInUser as User & { roles?: string[] }).roles!
        : getUserModules(loggedInUser),
    } as User;

    const ok = await afterUserAuthenticated(normalizedUser);
    window.dispatchEvent(new Event('posr-session'));
    return ok;
  };

  const checkLoginLegacy = async (pin: string) => {
    const record: any = await db.query(
      `SELECT * from ${Tables.users} where login = $pin and deleted_at = none and (login_method = 'pin' OR login_method = NONE) and crypto::bcrypt::compare(password, $pin) = true fetch user_role, user_shift`,
      { pin },
    );

    if (record[0].length > 0) {
      const loggedInUser = record[0][0];
      const roleId = typeof loggedInUser.user_role === "object" ? loggedInUser.user_role?.id : loggedInUser.user_role;
      let fetchedRole: UserRole | undefined;

      if (roleId) {
        const [roleRecords]: any = await db.query(`SELECT * FROM ${Tables.user_roles} WHERE id = $roleId AND deleted_at = none LIMIT 1`, {
          roleId,
        });
        fetchedRole = roleRecords?.[0];
      }

      const normalizedUser = {
        ...loggedInUser,
        user_role: fetchedRole || loggedInUser.user_role,
        roles: fetchedRole
          ? [...new Set(fetchedRole.roles || [])]
          : getUserModules(loggedInUser),
      };

      return afterUserAuthenticated(normalizedUser);
    }

    showLoginFailureToast();
    denyLogin();
    return false;
  };

  const checkLogin = async (pin: string) => {
    if (pin.trim().length === 4) {
      setIsAuthenticating(true);
      try {
        if (gatewayAuth) {
          return await checkLoginGateway(pin);
        }
        return await checkLoginLegacy(pin);
      } catch (err) {
        console.error(err);
        denyLogin();
        return false;
      } finally {
        setIsAuthenticating(false);
      }
    }
  }

  const allowLogin = (user: User) => {
    // Same user as the session that ended → back to that screen; anyone else starts
    // clean at the menu instead of inheriting the previous user's open order.
    const resume = decideResume(readResumePoint(), user.id);
    clearResumePoint();
    if (resume.kind === 'switch-user') {
      setEditSession(null);
      setAppState(prev => ({ ...prev, ...clearedOrderSelection }));
    }

    setPage(prev => ({
      ...prev,
      page: 'Menu',
      locked: false,
      lockedBy: undefined,
      user: user
    }));

    setCode('');

    navigation(resume.kind === 'resume' ? resume.path : MENU, { replace: true });
  }

  const denyLogin = () => {
    setCode('');
    setError(true);
  }

  useEffect(() => {
    void checkLogin(code).catch((err) => {
      console.error(err);
      setIsAuthenticating(false);
      denyLogin();
    });
  }, [code]);

  useEffect(() => {
    if(error){
      const timer = setTimeout(() => setError(false), 400);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useLayoutEffect(() => {
    // Gateway mode: user may exist in localStorage from another tab without a JWT here —
    // do not bounce back to the protected route or we loop Login ↔ report forever.
    if (gatewayAuth && !getSessionToken()) {
      return;
    }
    if (page.user && !page.locked) {
      const from = (location.state as { from?: { pathname: string; search?: string } })?.from;
      const returnPath = from ? `${from.pathname}${from.search ?? ''}` : MENU;
      navigation(returnPath, { replace: true });
    }
  }, [gatewayAuth, page.user, page.locked, location.state, navigation]);

  if (isAuthenticating) {
    return (
      <>
        <DocumentTitle parts={[t('login.title')]} />
        <PageLoader message={tCommon('database.connecting')} />
      </>
    );
  }

  return (
    <div className="relative bg-neutral-900 overflow-hidden" data-testid="login-page">
      <DocumentTitle parts={[t('login.title')]} />
      {loginLogo && (
        <div
          className="absolute inset-0 bg-center bg-cover blur-xl scale-110 opacity-30 pointer-events-none"
          style={{backgroundImage: `url("${loginLogo}")`}}
          data-testid="login-brand"
        />
      )}
      <div className="relative flex justify-center items-center h-screen flex-col gap-8">
        <h4 className="text-4xl text-neutral-100">{t('login.title')}</h4>
        {page.locked && (
          <div className="alert alert-warning" data-testid="login-locked-banner">{t('login.systemLocked', {
            name: `${page?.lockedBy?.first_name ?? ''} ${page?.lockedBy?.last_name ?? ''}`.trim()
          })}</div>
        )}
        <div className={
          cn(
            "flex gap-3 text-neutral-100",
            error && 'login-error'
          )
        }>
          <FontAwesomeIcon size="lg" icon={code.trim().length >= 1 ? faCircle : circleRegular} />
          <FontAwesomeIcon size="lg" icon={code.trim().length >= 2 ? faCircle : circleRegular} />
          <FontAwesomeIcon size="lg" icon={code.trim().length >= 3 ? faCircle : circleRegular} />
          <FontAwesomeIcon size="lg" icon={code.trim().length === 4 ? faCircle : circleRegular} />
        </div>
        <div className="wrapper w-[400px]" data-testid="login-pin-pad">
          <div className="grid grid-cols-3 gap-2 sm:gap-5 place-items-center">
            <button type="button" onClick={() => onKey('1')} className="btn-login">1</button>
            <button type="button" onClick={() => onKey('2')} className="btn-login">2</button>
            <button type="button" onClick={() => onKey('3')} className="btn-login">3</button>
            <button type="button" onClick={() => onKey('4')} className="btn-login">4</button>
            <button type="button" onClick={() => onKey('5')} className="btn-login">5</button>
            <button type="button" onClick={() => onKey('6')} className="btn-login">6</button>
            <button type="button" onClick={() => onKey('7')} className="btn-login">7</button>
            <button type="button" onClick={() => onKey('8')} className="btn-login">8</button>
            <button type="button" onClick={() => onKey('9')} className="btn-login">9</button>
            <button type="button" onClick={onBack} className="btn-login danger"><FontAwesomeIcon icon={faBackspace}/>
            </button>
            <button type="button" onClick={() => onKey('0')} className="btn-login">0</button>
            <button type="button" onClick={onClear} className="btn-login danger">C</button>
          </div>
        </div>
      </div>
      <div className="size-[100px] bg-warning-500/10 absolute top-10 right-[30%] rounded-full pointer-events-none transition-all blur-lg"></div>
      <div className="size-[200px] bg-primary-500/10 animate-bounce absolute top-20 left-[20%] rounded-full pointer-events-none transition-all blur-2xl"></div>
      <div className="size-[200px] bg-white/20 absolute bottom-[100px] transition-all right-24 pointer-events-none rotate-45 blur-2xl"></div>
      <div className="size-[200px] bg-[tomato]/20 absolute bottom-[30%] transition-all left-[150px] pointer-events-none blur-2xl"></div>
    </div>
  );
}
