import {useState} from "react";
import {useAtom} from "jotai";
import {toast} from "sonner";
import {useDB} from "@/api/db/db.ts";
import {appSettings} from "@/store/jotai.ts";
import {Button} from "@/components/common/input/button.tsx";
import {fetchPosCacheSnapshot} from "@/lib/pos-cache.ts";
import {useTranslation} from 'react-i18next';

export const CacheSettings = () => {
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

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-cache">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold mb-1">{t('cache.title')}</h2>
          <p className="text-sm text-neutral-500">{t('cache.description')}</p>
        </div>
        <Button variant="danger" size="lg" filled onClick={reloadCache} isLoading={isReloading}>
          {t('cache.reload')}
        </Button>
      </div>
    </div>
  );
};
