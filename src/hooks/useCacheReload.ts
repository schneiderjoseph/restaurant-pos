import {useState} from "react";
import {useAtom} from "jotai";
import {toast} from "sonner";
import {useDB} from "@/api/db/db.ts";
import {appSettings} from "@/store/jotai.ts";
import {fetchPosCacheSnapshot} from "@/lib/pos-cache.ts";
import {useTranslation} from 'react-i18next';

export const useCacheReload = () => {
  const db = useDB();
  const [, setSettings] = useAtom(appSettings);
  const [isReloading, setIsReloading] = useState(false);
  const { t } = useTranslation('settings');

  const reloadCache = async () => {
    try {
      setIsReloading(true);
      const snapshot = await fetchPosCacheSnapshot(db);
      setSettings(prev => ({
        ...prev,
        ...snapshot,
      }));
      toast.success(t('cache.reloaded'));
    } catch (error) {
      console.error("Failed to reload cache:", error);
      toast.error(t('cache.reloadFailed'));
    } finally {
      setIsReloading(false);
    }
  };

  return { isReloading, reloadCache };
};
