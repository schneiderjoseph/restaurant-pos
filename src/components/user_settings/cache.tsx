import {Button} from "@/components/common/input/button.tsx";
import {useCacheReload} from "@/hooks/useCacheReload.ts";
import {useTranslation} from 'react-i18next';

export const CacheSettings = () => {
  const { isReloading, reloadCache } = useCacheReload();
  const { t } = useTranslation('settings');

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
