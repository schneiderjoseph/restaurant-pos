import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBackspace, faCircle, faClock } from "@fortawesome/free-solid-svg-icons";
import {faCircle as circleRegular} from '@fortawesome/free-regular-svg-icons';
import {useEffect, useLayoutEffect, useState} from "react";
import { useAtom, useSetAtom } from "jotai";
import { appPage, appState } from "@/store/jotai.ts";
import { orderEditSessionAtom } from "@/store/order-edit-session.ts";
import { cn, toRecordId } from "@/lib/utils.ts";
import { DbNotReadyError, useDB } from "@/api/db/db.ts";
import { useDatabase } from "@/hooks/useDatabase.ts";
import { User } from "@/api/model/user.ts";
import {useNavigate, useLocation} from "react-router";
import {MENU} from "@/routes/posr.ts";
import { Modal } from "@/components/common/react-aria/modal.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { Tables } from "@/api/db/tables.ts";
import { toast } from "sonner";
import { getUserModules } from "@/lib/access.rules.ts";
import { UserRole } from "@/api/model/user_role.ts";
import { clockIn as laborClockIn } from "@/lib/labor-engine/attendance/attendance.service.ts";
import { ensureEmployeeForUser } from "@/lib/labor-engine/employee.resolver.ts";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { DocumentTitle } from "@/components/common/document-title.tsx";
import { PageLoader } from "@/components/common/loader/page-loader.tsx";
import {
  clearSessionTokens,
  gatewayLogin,
  getSessionToken,
  isGatewayAuthEnabled,
  setSessionTokens,
  type GatewayLoginResponse,
} from "@/lib/session.ts";
import { isHrModuleEnabled } from "@/lib/feature-modules.ts";
import { clearResumePoint, decideResume, readResumePoint } from "@/lib/session-resume.ts";
import { clearedOrderSelection } from "@/lib/browser-session.ts";

const TIME_ENTRY_CHECK_RETRIES = 3;
const TIME_ENTRY_RETRY_DELAY_MS = 400;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MINUTES = 15;

const sleep = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

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
  const [page, setPage] = useAtom(appPage);
  const setAppState = useSetAtom(appState);
  const setEditSession = useSetAtom(orderEditSessionAtom);
  const [error, setError] = useState(false);
  const [showClockInModal, setShowClockInModal] = useState(false);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
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
    if(code.trim().length <= 3){
      setCode(code + key);
    }
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

    // HR / clock-in disabled via VITE_MODULE_HR — skip attendance gate.
    if (!isHrModuleEnabled()) {
      allowLogin(normalizedUser);
      return true;
    }

    for (let attempt = 0; attempt < TIME_ENTRY_CHECK_RETRIES; attempt++) {
      try {
        const timeEntryCheck = await db.query(
          `SELECT * from ${Tables.time_entries} where user = $userId and clock_out = NONE and platform = $platform`,
          {
            userId: toRecordId(normalizedUser.id),
            platform: 'web',
          }
        );

        const rows = timeEntryCheck?.[0];
        if (!Array.isArray(rows)) {
          throw new Error('Unexpected time entry query result');
        }

        if (rows.length === 0) {
          setPendingUser(normalizedUser);
          setShowClockInModal(true);
        } else {
          allowLogin(normalizedUser);
        }
        return true;
      } catch (err) {
        const errName = err instanceof Error ? err.name : '';
        const isNotReady =
          err instanceof DbNotReadyError ||
          errName === 'ConnectionUnavailable' ||
          errName === 'EngineDisconnected';
        console.error(err);

        if (attempt < TIME_ENTRY_CHECK_RETRIES - 1 && isNotReady) {
          try {
            await connect();
          } catch (connectErr) {
            console.error(connectErr);
          }
          await sleep(TIME_ENTRY_RETRY_DELAY_MS);
          continue;
        }

        if (gatewayAuth) {
          failConnection();
        } else {
          toast.error(i18n.t('auth:login.connectionFailed', { defaultValue: 'Database connection failed after login' }));
          denyLogin();
        }
        return false;
      }
    }

    return false;
  };

  const getLockoutPolicyMessage = () => t('login.lockoutPolicy', {
    maxAttempts: LOGIN_MAX_ATTEMPTS,
    lockoutMinutes: LOGIN_LOCKOUT_MINUTES,
    defaultValue: `After ${LOGIN_MAX_ATTEMPTS} failed attempts, your account will be locked for ${LOGIN_LOCKOUT_MINUTES} minutes.`,
  });

  const showLoginFailureToast = (result?: GatewayLoginResponse) => {
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

    // Finish clock-in status check while Login is still mounted (session not announced yet).
    const ok = await afterUserAuthenticated(normalizedUser);
    // Sync provider with token presence (cleared on connection failure).
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
    setShowClockInModal(false);
    setPendingUser(null);

    navigation(resume.kind === 'resume' ? resume.path : MENU, { replace: true });
  }

  const handleClockIn = async () => {
    if(!pendingUser) return;

    try {
      const employee = await ensureEmployeeForUser(db, pendingUser);
      await laborClockIn(db, {
        user: pendingUser,
        employeeId: employee.id,
        platform: 'web',
        shiftTemplateId: pendingUser.user_shift?.id,
      });

      toast.success(i18n.t('auth:clockIn.success'));
      allowLogin(pendingUser);
    } catch (error) {
      toast.error(i18n.t('auth:clockIn.failed'));
      console.error(error);
    }
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
      setTimeout(() => setError(false), 400);
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
    <div className="relative" data-testid="login-page">
      <DocumentTitle parts={[t('login.title')]} />
      <div className="bg-neutral-900 flex justify-center items-center h-screen flex-col gap-8">
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

      {showClockInModal && (
        <Modal
          open={showClockInModal}
          onClose={() => {
            setShowClockInModal(false);
            setPendingUser(null);
            setCode('');
          }}
          title={t('clockIn.title')}
          shouldCloseOnOverlayClick={false}
          shouldCloseOnEsc={false}
        >
          <div className="flex flex-col gap-4 items-center">
            <div className="text-lg alert alert-danger">
              {t('clockIn.message')}
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                onClick={handleClockIn}
                icon={faClock}
                size="xl"
                data-testid="login-clock-in"
              >
                {t('clockIn.action')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
