import {useState} from "react";
import {Button} from "@/components/common/input/button.tsx";
import {useTranslation} from 'react-i18next';
import {playReadyChime, vibrateOrderReady} from "@/lib/order-ready-announcement.ts";

/** Lets a server check on their own device that the order-ready chime and vibration work. */
export const ReadyAlertTestSettings = () => {
  const { t } = useTranslation('settings');
  const [vibration, setVibration] = useState<ReturnType<typeof vibrateOrderReady>>();

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-ready-alert-test">
      <div className="flex items-start mb-5">
        <div>
          <h2 className="text-xl font-semibold mb-1">{t('readyAlertTest.title')}</h2>
          <p className="text-sm text-neutral-500">{t('readyAlertTest.description')}</p>
        </div>
      </div>
      <Button variant="primary" size="lg" onClick={() => {
        playReadyChime();
        setVibration(vibrateOrderReady());
      }}>
        {t('readyAlertTest.test')}
      </Button>
      {vibration && (
        <p className="text-sm mt-3" data-testid="ready-alert-test-result">
          {t(`readyAlertTest.${vibration}`)}
        </p>
      )}
    </div>
  )
}
