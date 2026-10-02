import { useTranslation } from 'react-i18next';

/** Short empty state when a tabbed screen has no visible tabs for the user. */
export const NoAccessibleTabs = () => {
  const { t } = useTranslation('common');
  return (
    <div
      className="bg-white shadow p-8 text-center text-neutral-600"
      data-testid="no-accessible-tabs"
    >
      {t('moduleAccess.noTabs')}
    </div>
  );
};
