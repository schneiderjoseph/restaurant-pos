import {DateRangePicker} from "@/components/common/antd/date.range.picker.tsx";
import {useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import {DateTime} from "luxon";
import { Dayjs } from "dayjs";
import {getAppTimezone} from "@/lib/datetime.ts";

interface DateRangeProps {
  startName?: string;
  endName?: string;
  label?: string;
  isRequired?: boolean;
}

type PresetKey =
  | "today"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "lastYear"
  | "allTime"
  | "custom";

const DATE_TIME_FORMAT = import.meta.env.VITE_DATE_TIME_FORMAT as string;

const resolvePresetRange = (key: PresetKey): [string, string] => {
  const now = DateTime.now().setZone(getAppTimezone());
  switch (key) {
    case "today":
      return [
        now.startOf("day").toFormat(DATE_TIME_FORMAT),
        now.endOf("day").toFormat(DATE_TIME_FORMAT),
      ];
    case "yesterday": {
      const day = now.minus({day: 1});
      return [
        day.startOf("day").toFormat(DATE_TIME_FORMAT),
        day.endOf("day").toFormat(DATE_TIME_FORMAT),
      ];
    }
    case "thisWeek":
      return [
        now.startOf("week").toFormat(DATE_TIME_FORMAT),
        now.endOf("week").toFormat(DATE_TIME_FORMAT),
      ];
    case "lastWeek": {
      const week = now.minus({week: 1});
      return [
        week.startOf("week").toFormat(DATE_TIME_FORMAT),
        week.endOf("week").toFormat(DATE_TIME_FORMAT),
      ];
    }
    case "thisMonth":
      return [
        now.startOf("month").toFormat(DATE_TIME_FORMAT),
        now.endOf("month").toFormat(DATE_TIME_FORMAT),
      ];
    case "lastMonth": {
      const month = now.minus({month: 1});
      return [
        month.startOf("month").toFormat(DATE_TIME_FORMAT),
        month.endOf("month").toFormat(DATE_TIME_FORMAT),
      ];
    }
    case "thisYear":
      return [
        now.startOf("year").toFormat(DATE_TIME_FORMAT),
        now.endOf("year").toFormat(DATE_TIME_FORMAT),
      ];
    case "lastYear": {
      const year = now.minus({year: 1});
      return [
        year.startOf("year").toFormat(DATE_TIME_FORMAT),
        year.endOf("year").toFormat(DATE_TIME_FORMAT),
      ];
    }
    case "allTime":
      return ["", ""];
    default:
      return ["", ""];
  }
};

const formatCustomBound = (value: Dayjs): string =>
  DateTime.fromObject(
    {
      year: value.year(),
      month: value.month() + 1,
      day: value.date(),
      hour: value.hour(),
      minute: value.minute(),
      second: 0,
    },
    {zone: getAppTimezone()},
  ).toFormat(DATE_TIME_FORMAT);

export function DateRange({
  startName = "start",
  endName = "end",
  label,
  isRequired = false,
}: DateRangeProps) {
  const { t } = useTranslation('reports');
  const resolvedLabel = label ?? t('filters.selectRange');

  const presetOptions = useMemo(() => {
    const keys: PresetKey[] = [
      "today",
      "yesterday",
      "thisWeek",
      "lastWeek",
      "thisMonth",
      "lastMonth",
      "thisYear",
      "lastYear",
      ...(isRequired ? [] : (["allTime"] as PresetKey[])),
      "custom",
    ];
    return keys.map((key) => ({
      key,
      label: t(`datePresets.${key}`),
    }));
  }, [isRequired, t]);

  const [selectedKey, setSelectedKey] = useState<PresetKey>("today");
  const [isCustom, setCustom] = useState(false);
  const [customRange, setCustomRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);

  const preset = selectedKey === "custom" ? (["", ""] as [string, string]) : resolvePresetRange(selectedKey);
  const customStart = customRange?.[0] ? formatCustomBound(customRange[0]) : "";
  const customEnd = customRange?.[1] ? formatCustomBound(customRange[1]) : "";
  const datesRequired = isRequired && selectedKey !== "allTime";
  const customComplete = Boolean(customStart && customEnd);

  return (
    <div className="flex flex-col w-full">
      <label htmlFor="date-preset">{resolvedLabel}</label>
      <select
        id="date-preset"
        onChange={(event) => {
          const nextKey = event.target.value as PresetKey;
          setSelectedKey(nextKey);
          setCustom(nextKey === "custom");
        }}
        value={selectedKey}
        className="form-control self-center"
      >
        {presetOptions.map((item) => (
          <option key={item.key} value={item.key}>{item.label}</option>
        ))}
      </select>
      {!isCustom && (
        <>
          <input type="hidden" name={startName} value={preset[0]} required={datesRequired}/>
          <input type="hidden" name={endName} value={preset[1]} required={datesRequired}/>
        </>
      )}
      {isCustom && (
        <div className="mt-3">
          <DateRangePicker
            startName="_date_range_ui_start"
            endName="_date_range_ui_end"
            required={false}
            value={customRange}
            onChange={(nextValue) => {
              setCustomRange(nextValue);
            }}
          />
          <input type="hidden" name={startName} value={customStart} required={datesRequired}/>
          <input type="hidden" name={endName} value={customEnd} required={datesRequired}/>
          {datesRequired && !customComplete && (
            <input type="text" required value="" readOnly tabIndex={-1} aria-hidden className="sr-only" />
          )}
        </div>
      )}

    </div>
  );
}
