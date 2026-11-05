import {useCallback, useEffect, useMemo, useState} from "react";
import {Info} from "luxon";
import {useTranslation} from "react-i18next";
import {toast} from "sonner";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Setting} from "@/api/model/setting.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {
  DEFAULT_FISCAL_START_MONTH,
  FISCAL_YEAR_KEY,
  fiscalYearLabel,
  fiscalYearRange,
  normalizeFiscalStartMonth,
  resetFiscalStartMonthCache,
} from "@/lib/fiscal-year.ts";
import {nowInAppTimezone} from "@/lib/datetime.ts";

/** First month of the fiscal year, used by reports (fiscal-year presets, monthly and yearly sales). */
export const FiscalYearSettingsCard = () => {
  const db = useDB();
  const {t, i18n} = useTranslation(["settings", "common"]);
  const {protectFormSubmit} = useSecurity();
  const isVisible = useActionVisible();
  const canSave = isVisible("settings.fiscal_year");
  const [setting, setSetting] = useState<Setting>();
  const [startMonth, setStartMonth] = useState(DEFAULT_FISCAL_START_MONTH);

  const load = useCallback(async () => {
    const [rows] = await db.query(
      `SELECT * FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1`,
      {key: FISCAL_YEAR_KEY},
    ) as [Setting[] | undefined];
    setSetting(rows?.[0]);
    setStartMonth(normalizeFiscalStartMonth(rows?.[0]?.values?.start_month));
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  const months = useMemo(() => Info.months("long", {locale: i18n.language}), [i18n.language]);
  const current = fiscalYearRange(nowInAppTimezone(), startMonth);
  const preview = t("settings:fiscalYear.preview", {
    label: fiscalYearLabel(current.start),
    from: current.start.setLocale(i18n.language).toFormat("d LLL yyyy"),
    to: current.end.setLocale(i18n.language).toFormat("d LLL yyyy"),
  });

  const save = async () => {
    const values = {start_month: normalizeFiscalStartMonth(startMonth)};
    if (setting?.id) {
      await db.merge(setting.id, {values});
    } else {
      await db.create(Tables.settings, {key: FISCAL_YEAR_KEY, is_global: true, values});
    }
    resetFiscalStartMonthCache();
    toast.success(t("settings:fiscalYear.updated"));
    await load();
  };

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-fiscal-year">
      <h2 className="text-xl font-semibold mb-1">{t("settings:fiscalYear.title")}</h2>
      <p className="text-sm text-neutral-500 mb-5">{t("settings:fiscalYear.description")}</p>
      <form
        onSubmit={protectFormSubmit(
          () => void save(),
          {module: "settings.fiscal_year", description: t("settings:fiscalYear.saveDescription")},
        )}
      >
        <label htmlFor="fiscal-start-month" className="block mb-1">{t("settings:fiscalYear.startMonth")}</label>
        <select
          id="fiscal-start-month"
          className="input w-full rounded-lg border border-neutral-300 px-3 py-2 mb-2"
          value={startMonth}
          disabled={!canSave}
          onChange={(event) => setStartMonth(normalizeFiscalStartMonth(event.target.value))}
        >
          {months.map((name, index) => (
            <option key={name} value={index + 1}>{name}</option>
          ))}
        </select>
        <p className="text-sm text-neutral-600 mb-5">{preview}</p>
        {canSave && <button className="btn btn-primary" type="submit">{t("common:actions.save")}</button>}
      </form>
    </div>
  );
};
