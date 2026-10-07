import {REPORTS_SALES_WEEKLY} from "@/routes/posr.ts";
import {Button} from "@/components/common/input/button.tsx";
import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import {useDB} from "@/api/db/db.ts";
import {DateTime} from "luxon";
import {DateTime as SurrealDateTime} from 'surrealdb';
import {Tables} from "@/api/db/tables.ts";
import {getAppTimezone} from "@/lib/datetime.ts";

interface WeekOption {
  label: string;
  value: string;
}

const formatWeekLabel = (date: DateTime) => {
  const zone = getAppTimezone();
  const start = date.setZone(zone).startOf('week');
  const end = start.plus({days: 6});
  return `${start.toFormat('yyyy-LL-dd')} → ${end.toFormat('yyyy-LL-dd')}`;
};

const parseCreatedAt = (value?: string | Date | null | SurrealDateTime) => {
  if (!value) {
    return null;
  }
  const zone = getAppTimezone();
  if (typeof value === 'string') {
    const parsed = DateTime.fromISO(value, {zone});
    return parsed.isValid ? parsed.setZone(zone) : null;
  }

  if(value instanceof SurrealDateTime){
    value = value.toDate();
  }

  const parsed = DateTime.fromJSDate(value, {zone});
  return parsed.isValid ? parsed : null;
};

export const SalesWeeklyFilter = () => {
  const { t } = useTranslation('reports');
  const db = useDB();
  const queryRef = useRef(db.query);
  const [weeks, setWeeks] = useState<WeekOption[]>([]);
  const [selectedWeek, setSelectedWeek] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    queryRef.current = db.query;
  }, [db]);

  useEffect(() => {
    let isMounted = true;

    const fetchWeeks = async () => {
      try {
        if (!queryRef.current) {
          return;
        }

        setLoading(true);
        const result: any = await queryRef.current(
          `SELECT created_at FROM ${Tables.orders} WHERE created_at != NONE ORDER BY created_at ASC LIMIT 1`
        );

        const firstOrderRecord = result?.[0]?.[0];
        const firstOrderDate = parseCreatedAt(firstOrderRecord?.created_at);
        const zone = getAppTimezone();
        const start = firstOrderDate?.setZone(zone).startOf('week') || DateTime.now().setZone(zone).startOf('week');
        const end = DateTime.now().setZone(zone).startOf('week');

        const generatedWeeks: WeekOption[] = [];
        let current = start;
        while (current <= end) {
          generatedWeeks.push({
            value: current.toFormat("yyyy-LL-dd"),
            label: formatWeekLabel(current),
          });
          current = current.plus({weeks: 1});
        }

        if (isMounted) {
          setWeeks(generatedWeeks);
          setSelectedWeek(generatedWeeks.at(-1)?.value);
          setError(null);
        }
      } catch (err) {
        console.error("Failed to load weeks:", err);
        if (isMounted) {
          setError(t('filters.unableToLoadWeeks'));
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchWeeks().catch(() => {
      // already handled inside fetchWeeks
    });

    return () => {
      isMounted = false;
    };
  }, [t]);

  const weekOptions = useMemo(() => {
    return weeks.map((week) => (
      <option key={week.value} value={week.value}>
        {week.label}
      </option>
    ));
  }, [weeks]);

  return (
    <form
      action={REPORTS_SALES_WEEKLY}
      className="flex flex-col gap-3 items-start"
      target="_blank"
    >
      <div>
        <label htmlFor="week-select">{t('filters.selectWeek')}</label>
        <select
          id="week-select"
          name="week"
          className="input bg-white w-full min-w-0 sm:min-w-[260px]"
          disabled={loading || !!error}
          value={selectedWeek}
          onChange={(event) => setSelectedWeek(event.target.value)}
          required
        >
          {!loading && !weeks.length && (
            <option>{t('filters.noWeeksAvailable')}</option>
          )}
          {weekOptions}
        </select>
        {loading && <p className="text-sm text-gray-500">{t('filters.loadingWeeks')}</p>}
        {error && <p className="text-sm text-danger-600">{error}</p>}
      </div>

      <Button
        variant="primary"
        filled
        type="submit"
        disabled={!selectedWeek}
      >{t('filters.generate')}</Button>
    </form>
  );
}