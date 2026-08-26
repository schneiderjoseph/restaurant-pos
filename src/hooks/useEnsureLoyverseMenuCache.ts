import { useEffect, useRef } from 'react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import { useDB } from '@/api/db/db.ts';
import { appSettings } from '@/store/jotai.ts';
import { isLoyverseMode } from '@/lib/pos-mode.ts';
import { cacheHasLoyverseMenu, fetchPosCacheSnapshot } from '@/lib/pos-cache.ts';

const SESSION_KEY = 'posr_loyverse_menu_cache_loaded';

/**
 * After Loyverse menu sync, devices keep a stale IndexedDB settings cache.
 * Reload once per browser session when Loyverse mode is on.
 */
export function useEnsureLoyverseMenuCache() {
  const db = useDB();
  const [settings, setSettings] = useAtom(appSettings);
  const ranRef = useRef(false);

  useEffect(() => {
    if (!isLoyverseMode() || ranRef.current) {
      return;
    }

    let already = false;
    try {
      already = sessionStorage.getItem(SESSION_KEY) === '1';
    } catch {
      // ignore
    }

    if (already && cacheHasLoyverseMenu(settings.menus)) {
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
        if (cacheHasLoyverseMenu(snapshot.menus)) {
          toast.success('Menu Loyverse actualisé');
        }
      } catch (error) {
        console.error('Failed to load Loyverse menu cache', error);
        ranRef.current = false;
        toast.error('Impossible de charger le menu Loyverse — Settings → Reload cache');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, setSettings, settings.menus]);
}
