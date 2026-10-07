import {REPORTS_CASH_CLOSING} from "@/routes/posr.ts";
import {Button} from "@/components/common/input/button.tsx";
import {DatePicker} from "@/components/common/antd/datepicker.tsx";
import {DateValue} from "react-aria-components";
import {useState} from "react";
import { useTranslation } from 'react-i18next';
import {getToday} from "@/utils/date.ts";

export const CashClosingFilter = () => {
  const { t } = useTranslation('reports');
  const [selectedDate, setSelectedDate] = useState<DateValue | null>(getToday());

  return (
    <form
      action={REPORTS_CASH_CLOSING}
      className="flex flex-col gap-3 items-start"
      target="_blank"
    >
      <div className="w-full">
        <DatePicker
          label={t('filters.selectDate')}
          name="date"
          value={selectedDate}
          onChange={setSelectedDate}
          maxValue={getToday()}
          isClearable
        />
      </div>

      <Button
        variant="primary"
        filled
        type="submit"
        disabled={!selectedDate}
      >{t('filters.generate')}</Button>
    </form>
  );
}
