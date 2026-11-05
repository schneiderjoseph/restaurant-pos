import { useTranslation } from 'react-i18next';
import { REPORTS_CASH_AUDIT, REPORTS_KITCHEN_TIMING, REPORTS_SHIFTS } from '@/routes/posr.ts';
import { DateRange } from '@/components/reports/filters/date.range.tsx';
import { Button } from '@/components/common/input/button.tsx';

const selectClass = 'input w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm';

/** Shift report: date range only. */
export const ShiftsFilter = () => {
  const { t } = useTranslation('reports');
  return (
    <form action={REPORTS_SHIFTS} className="flex flex-col gap-3 items-start" target="_blank">
      <DateRange isRequired />
      <Button variant="primary" filled type="submit">{t('filters.generate')}</Button>
    </form>
  );
};

/** Cash audit: date range + how close to payment a change must be to count. */
export const CashAuditFilter = () => {
  const { t } = useTranslation('reports');
  return (
    <form action={REPORTS_CASH_AUDIT} className="flex flex-col gap-3 items-start" target="_blank">
      <DateRange isRequired />
      <div className="flex flex-col gap-1 w-full max-w-xs">
        <label htmlFor="cash-audit-window">{t('cashAudit.windowLabel')}</label>
        <select id="cash-audit-window" name="window" defaultValue="30" className={selectClass}>
          {[10, 30, 60, 120].map((m) => (
            <option key={m} value={m}>{t('cashAudit.windowOption', { count: m })}</option>
          ))}
        </select>
      </div>
      <Button variant="primary" filled type="submit">{t('filters.generate')}</Button>
    </form>
  );
};

/** Kitchen timing: date range + the hours of the day to look at (whole day by default). */
export const KitchenTimingFilter = () => {
  const { t } = useTranslation('reports');
  const hours = Array.from({ length: 25 }, (_, h) => h);
  return (
    <form action={REPORTS_KITCHEN_TIMING} className="flex flex-col gap-3 items-start" target="_blank">
      <DateRange isRequired />
      <div className="grid grid-cols-2 gap-3 w-full max-w-sm">
        <div className="flex flex-col gap-1">
          <label htmlFor="kitchen-from-hour">{t('kitchenTiming.fromHour')}</label>
          <select id="kitchen-from-hour" name="from_hour" defaultValue="0" className={selectClass}>
            {hours.slice(0, 24).map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="kitchen-to-hour">{t('kitchenTiming.toHour')}</label>
          <select id="kitchen-to-hour" name="to_hour" defaultValue="24" className={selectClass}>
            {hours.slice(1).map((h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
          </select>
        </div>
      </div>
      <Button variant="primary" filled type="submit">{t('filters.generate')}</Button>
    </form>
  );
};
