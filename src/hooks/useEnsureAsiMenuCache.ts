import { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import { useDB } from '@/api/db/db.ts';
import { appSettings } from '@/store/jotai.ts';
import { isAsiMode } from '@/lib/pos-mode.ts';
import { cacheHasAsiMenu, fetchPosCacheSnapshot } from '@/lib/pos-cache.ts';

const SESSION_KEY = 'posr_asi_menu_cache_loaded';

/**
 * After ASI menu sync, devices keep a stale IndexedDB settings cache.
 * Reload once per browser session when ASI mode is on.
 */
export function useEnsureAsiMenuCache() {
  const db = useDB();
  const [settings, setSettings] = useAtom(appSettings);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isAsiMode() || ranRef.current) {
      return;
    }

    let already = false;
    try {
      already = sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      // ignore
    }

    if (already && cacheHasAsiMenu(settings.menus)) {
      return;
    }

    ranRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await fetchPosCacheSnapshot(db);
        if (cancelled) {
          return;
        }
        setSettings((prev) => ({
          ...prev,
          ...snapshot,
        }));
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
        } catch {
          // ignore
        }
        if (cacheHasAsiMenu(snapshot.menus)) {
          toast.success('Menu ASI actualisé');
        }
      } catch (error) {
        console.error('Failed to load ASI menu cache', error);
        ranRef.current = false;
        toast.error('Impossible de charger le menu ASI — Settings → Reload cache');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, setSettings, settings.menus]);
}
