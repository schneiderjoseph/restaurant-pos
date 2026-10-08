import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAtomValue } from 'jotai';
import { appPage } from '@/store/jotai.ts';
import { useDB } from '@/api/db/db.ts';
import { fetchUserModules, userModulesGrant } from '@/lib/access.rules.ts';

export type ModuleAccessValue = {
  ready: boolean;
  modules: string[];
  can: (moduleId: string) => boolean;
  /** Signed-in user id the current modules belong to (undefined when logged out). */
  userId?: string;
};

const defaultValue: ModuleAccessValue = {
  ready: false,
  modules: [],
  can: () => false,
  userId: undefined,
};

const ModuleAccessContext = createContext<ModuleAccessValue>(defaultValue);

/**
 * Fetches permission modules once per signed-in user id and exposes
 * `{ ready, modules, can }` for navigation/tab filtering.
 * Mount once inside the authenticated tree (see ProtectedRoute).
 */
export const ModuleAccessProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAtomValue(appPage);
  const db = useDB();
  const queryRef = useRef(db.query);
  queryRef.current = db.query;

  const userId = user?.id;
  const userRef = useRef(user);
  userRef.current = user;

  const [modules, setModules] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!userId) {
      setModules([]);
      setResolvedUserId(undefined);
      setReady(true);
      return;
    }

    setReady(false);
    let cancelled = false;

    void (async () => {
      const currentUser = userRef.current;
      if (!currentUser) {
        if (!cancelled) {
          setModules([]);
          setResolvedUserId(undefined);
          setReady(true);
        }
        return;
      }

      const stableDb = {
        query: (sql: string, params?: Record<string, unknown>) => queryRef.current(sql, params),
      };
      const fetched = await fetchUserModules(stableDb, currentUser);
      if (!cancelled) {
        setModules(fetched);
        setResolvedUserId(userId);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const can = useCallback(
    (moduleId: string) => userModulesGrant(modules, moduleId),
    [modules],
  );

  // The effect resets `ready` one render after the user changes; until it has,
  // the modules still belong to the previous user and must not be trusted.
  const readyForUser = ready && String(resolvedUserId ?? '') === String(userId ?? '');

  const value = useMemo<ModuleAccessValue>(
    () => ({
      ready: readyForUser,
      modules,
      can,
      userId: resolvedUserId,
    }),
    [readyForUser, modules, can, resolvedUserId],
  );

  return (
    <ModuleAccessContext.Provider value={value}>
      {children}
    </ModuleAccessContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- context file exports its hook
export const useModuleAccess = (): ModuleAccessValue => useContext(ModuleAccessContext);
