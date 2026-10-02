import { useAtom } from 'jotai';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { faPowerOff } from '@fortawesome/free-solid-svg-icons';
import { appPage } from '@/store/jotai.ts';
import { logoutSession } from '@/lib/session.actions.ts';
import { Button } from '@/components/common/input/button.tsx';
import { DocumentTitle } from '@/components/common/document-title.tsx';

/** Minimal screen when the signed-in user has no openable top-level page. */
export const NoModuleAccess = () => {
  const { t } = useTranslation('common');
  const [, setPage] = useAtom(appPage);
  const navigate = useNavigate();

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-100 px-6"
      data-testid="no-module-access"
    >
      <DocumentTitle parts={[t('moduleAccess.noAccessTitle')]} />
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-neutral-900">{t('moduleAccess.noAccessTitle')}</h1>
        <p className="mt-2 text-neutral-600">{t('moduleAccess.noAccessDescription')}</p>
      </div>
      <Button
        variant="danger"
        size="lg"
        icon={faPowerOff}
        data-testid="no-module-access-logout"
        onClick={() => {
          void logoutSession(setPage, navigate);
        }}
      >
        {t('actions.logout')}
      </Button>
    </div>
  );
};
