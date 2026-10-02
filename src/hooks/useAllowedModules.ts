import {useEffect, useRef, useState} from "react";
import {useDB} from "@/api/db/db.ts";
import type {User} from "@/api/model/user.ts";
import {fetchUserModules, getUserModules} from "@/lib/access.rules.ts";
import {useModuleAccess} from "@/providers/module-access.provider.tsx";

/**
 * Permission modules for the signed-in user. Prefers the shared ModuleAccess
 * source when mounted (same fetch as sidebar/route guard); otherwise re-fetches
 * user_role from Surreal so callers outside the provider still work.
 */
export const useAllowedModules = (user?: User): string[] => {
  const shared = useModuleAccess();
  const db = useDB();
  const queryRef = useRef(db.query);
  queryRef.current = db.query;
  const userRef = useRef(user);
  userRef.current = user;

  const userId = user?.id;
  const sharedMatches =
    shared.ready &&
    shared.userId != null &&
    userId != null &&
    shared.userId === userId;

  const [modules, setModules] = useState<string[]>(() => getUserModules(user));

  useEffect(() => {
    if (sharedMatches) {
      setModules(shared.modules);
      return;
    }

    const currentUser = userRef.current;
    if (!userId || !currentUser) {
      setModules([]);
      return;
    }

    let cancelled = false;

    void (async () => {
      const stableDb = {
        query: (sql: string, params?: Record<string, unknown>) => queryRef.current(sql, params),
      };
      const fetched = await fetchUserModules(stableDb, currentUser);
      if (!cancelled) {
        setModules(fetched);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, sharedMatches, shared.modules]);

  if (sharedMatches) {
    return shared.modules;
  }

  return modules;
};
