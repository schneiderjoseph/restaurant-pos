import {useEffect, useMemo, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {REPORTS_SALES_MONTHLY} from '@/routes/posr.ts';
import {Button} from '@/components/common/input/button.tsx';
import {useDB} from '@/api/db/db.ts';
import {nowInAppTimezone} from '@/lib/datetime.ts';
import {DEFAULT_FISCAL_START_MONTH, fiscalYearLabel, fiscalYearStart, loadFiscalStartMonth} from '@/lib/fiscal-year.ts';

const YEARS_LISTED = 6;

/** Monthly and yearly sales: which fiscal year to show (compared with the one before). */
export const SalesMonthlyFilter = () => {
  const {t} = useTranslation('reports');
  const db = useDB();
  const [startMonth, setStartMonth] = useState(DEFAULT_FISCAL_START_MONTH);

  useEffect(() => {
    let alive = true;
    void loadFiscalStartMonth(db).then((m) => {
      if (alive) setStartMonth(m);
    });
    return () => {
      alive = false;
    };
  }, [db]);

  const years = useMemo(() => {
    const current = fiscalYearStart(nowInAppTimezone(), startMonth);
    return Array.from({length: YEARS_LISTED}, (_, i) => current.minus({years: i}));
  }, [startMonth]);

  return (
    <form action={REPORTS_SALES_MONTHLY} className="flex flex-col gap-3 items-start" target="_blank">
      <div className="flex flex-col gap-1 w-full max-w-xs">
        <label htmlFor="monthly-fy">{t('monthlyReport.fiscalYear')}</label>
        <select id="monthly-fy" name="fy" defaultValue={String(years[0].year)} key={startMonth} className="input w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          {years.map((start, i) => (
            <option key={start.year} value={start.year}>
              {fiscalYearLabel(start)}{i === 0 ? ` — ${t('monthlyReport.current')}` : ''}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-neutral-500 max-w-xs">{t('monthlyReport.filterHint')}</p>
      <Button variant="primary" filled type="submit">{t('filters.generate')}</Button>
    </form>
  );
};
