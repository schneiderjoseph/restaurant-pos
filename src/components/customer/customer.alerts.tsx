import { useTranslation } from 'react-i18next';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCakeCandles, faChair, faCrown, faLeaf, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { Customer } from '@/api/model/customer.ts';
import {
  customerAllergies,
  customerDiets,
  isBirthdayToday,
} from '@/lib/customer-preferences.ts';
import { nowInAppTimezone } from '@/lib/datetime.ts';
import { cn } from '@/lib/utils.ts';

interface Props {
  customer?: Customer | null;
  /** One line of chips (order screen) instead of the full panel (guest lookup). */
  compact?: boolean;
  /** Hide the free-text note (shown elsewhere on the screen). */
  hideNotes?: boolean;
  /** Kitchen screen: only what changes the cooking (allergies, diet, note) — no VIP, birthday or seating. */
  kitchen?: boolean;
  className?: string;
}

/** What staff must see before serving the customer: allergies first, then diet, VIP, seating… */
export const CustomerAlerts = ({ customer, compact, hideNotes, kitchen, className }: Props) => {
  const { t } = useTranslation('menu');
  if (!customer) return null;

  const allergies = customerAllergies(customer);
  const diets = customerDiets(customer);
  const seating = kitchen ? '' : customer.seating_pref?.trim();
  const notes = hideNotes ? '' : customer.notes?.trim();
  const appToday = nowInAppTimezone();
  const birthday = !kitchen && isBirthdayToday(
    customer.birthday,
    new Date(appToday.year, appToday.month - 1, appToday.day),
  );
  const vip = !kitchen && Boolean(customer.vip);

  if (!allergies.length && !diets.length && !seating && !notes && !birthday && !vip) {
    return null;
  }

  const dietLabel = (key: string) => t(`customer.diet.${key}`, { defaultValue: key });

  if (compact) {
    return (
      <div className={cn('flex flex-wrap gap-1.5 items-center', className)} data-testid="customer-alerts-compact">
        {allergies.length > 0 && (
          <span className="rounded-md bg-danger-600 text-white px-2 py-0.5 text-sm font-bold">
            <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1" />
            {allergies.join(', ')}
          </span>
        )}
        {diets.map((diet) => (
          <span key={diet} className="rounded-md bg-success-100 text-success-800 px-2 py-0.5 text-sm">
            {dietLabel(diet)}
          </span>
        ))}
        {vip && (
          <span className="rounded-md bg-warning-100 text-warning-800 px-2 py-0.5 text-sm font-semibold">
            <FontAwesomeIcon icon={faCrown} className="mr-1" />{t('customer.vip')}
          </span>
        )}
        {birthday && (
          <span className="rounded-md bg-info-100 text-info-800 px-2 py-0.5 text-sm">
            <FontAwesomeIcon icon={faCakeCandles} className="mr-1" />{t('customer.birthdayToday')}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2', className)} data-testid="customer-alerts">
      {allergies.length > 0 && (
        <div className="rounded-lg border-2 border-danger-500 bg-danger-100 p-3" data-testid="customer-allergies">
          <div className="font-bold text-danger-700 text-sm uppercase">
            <FontAwesomeIcon icon={faTriangleExclamation} className="mr-1" />
            {t('customer.allergies')}
          </div>
          <div className="text-lg font-semibold text-danger-800">{allergies.join(', ')}</div>
        </div>
      )}
      {(diets.length > 0 || vip || birthday || seating) && (
        <div className="flex flex-wrap gap-2">
          {vip && (
            <span className="rounded-lg bg-warning-100 text-warning-800 px-3 py-1.5 font-semibold">
              <FontAwesomeIcon icon={faCrown} className="mr-1" />{t('customer.vip')}
            </span>
          )}
          {birthday && (
            <span className="rounded-lg bg-info-100 text-info-800 px-3 py-1.5 font-medium">
              <FontAwesomeIcon icon={faCakeCandles} className="mr-1" />{t('customer.birthdayToday')}
            </span>
          )}
          {diets.map((diet) => (
            <span key={diet} className="rounded-lg bg-success-100 text-success-800 px-3 py-1.5">
              <FontAwesomeIcon icon={faLeaf} className="mr-1" />{dietLabel(diet)}
            </span>
          ))}
          {seating && (
            <span className="rounded-lg bg-neutral-100 text-neutral-700 px-3 py-1.5">
              <FontAwesomeIcon icon={faChair} className="mr-1" />{seating}
            </span>
          )}
        </div>
      )}
      {notes && (
        <div className="rounded-lg border border-warning-300 bg-warning-100 p-3" data-testid="guest-note-banner">
          <div className="font-bold text-sm mb-1">{t('guest.notes')}</div>
          <div className="whitespace-pre-wrap text-lg">{notes}</div>
        </div>
      )}
    </div>
  );
};
