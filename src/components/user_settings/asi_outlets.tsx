import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import { ReactSelect } from "@/components/common/input/custom.react.select.tsx";
import { Setting } from "@/api/model/setting.ts";
import { toast } from "sonner";
import { useSecurity } from "@/hooks/useSecurity.ts";
import { useActionVisible } from "@/hooks/useActionVisible.ts";
import {
  ASI_OUTLETS_KEY,
  ASI_POS_IDS_KEY,
  AsiOutlet,
} from "@/api/model/asi_outlets.ts";
import { useTranslation } from "react-i18next";

interface OutletOption {
  label: string;
  value: number;
}

interface FormValues {
  outlets: OutletOption[];
}

/**
 * Which ASI outlets feed the menu. The list comes from asi-sync, which also
 * applies the choice on its next pass. Hidden where ASI is not synced.
 */
export const AsiOutletsSettingsCard = () => {
  const db = useDB();
  const [settings, setSettings] = useState<Setting>();
  const [outlets, setOutlets] = useState<AsiOutlet[]>([]);
  const { protectFormSubmit } = useSecurity();
  const isVisible = useActionVisible();
  const canSave = isVisible('settings.menus');
  const { t } = useTranslation(['settings', 'common']);

  const { control, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: { outlets: [] },
  });

  const options = useMemo<OutletOption[]>(() => {
    return outlets.map((outlet) => ({
      label: outlet.is_active
        ? outlet.name
        : t('settings:asiOutlets.inactiveOutlet', { name: outlet.name }),
      value: outlet.pos_id,
    }));
  }, [outlets, t]);

  const loadSettings = async () => {
    const [rows] = await db.query<[Setting[]]>(
      `SELECT * FROM ${Tables.settings} WHERE key INSIDE $keys AND is_global = true`,
      { keys: [ASI_OUTLETS_KEY, ASI_POS_IDS_KEY] }
    );
    const list = rows?.find((row) => row.key === ASI_OUTLETS_KEY)?.values;
    setOutlets(Array.isArray(list) ? list : []);
    setSettings(rows?.find((row) => row.key === ASI_POS_IDS_KEY));
  };

  const saveSettings = async (values: FormValues) => {
    const payload = (values.outlets ?? []).map((option) => option.value);

    if (settings?.id) {
      await db.merge(settings.id, { values: payload });
    } else {
      await db.create(Tables.settings, {
        key: ASI_POS_IDS_KEY,
        is_global: true,
        values: payload,
      });
    }

    toast.success(t('settings:asiOutlets.updated'));
    await loadSettings();
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    const selected: number[] = Array.isArray(settings?.values) ? settings.values.map(Number) : [];
    // Keep the saved order: it is the price priority.
    reset({
      outlets: selected
        .map((posId) => options.find((option) => option.value === posId))
        .filter((option): option is OutletOption => !!option),
    });
  }, [settings, options, reset]);

  if (outlets.length === 0) {
    return null;
  }

  return (
    <div className="break-inside-avoid mb-5 shadow p-5 rounded-xl bg-white" data-testid="settings-card-asi-outlets">
      <h2 className="text-xl font-semibold mb-1">{t('settings:asiOutlets.title')}</h2>
      <p className="text-sm text-neutral-500 mb-5">
        {t('settings:asiOutlets.description')}
      </p>
      <form
        onSubmit={protectFormSubmit(handleSubmit(saveSettings), {
          module: 'settings.menus',
          description: t('settings:asiOutlets.saveDescription'),
        })}
      >
        <div className="grid grid-cols-1 gap-5 mb-5">
          <Controller
            name="outlets"
            control={control}
            render={({ field }) => (
              <div>
                <label>{t('settings:asiOutlets.outlets')}</label>
                <ReactSelect
                  isMulti
                  options={options}
                  value={field.value}
                  onChange={field.onChange}
                  placeholder={t('settings:asiOutlets.allOutlets')}
                />
              </div>
            )}
          />
        </div>
        {canSave && (
          <button className="btn btn-primary" type="submit">
            {t('common:actions.save')}
          </button>
        )}
      </form>
    </div>
  );
};
