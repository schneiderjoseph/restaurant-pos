import { useCallback, useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import { Setting } from '@/api/model/setting.ts';
import {
  DEFAULT_SESSION_SECURITY,
  MIN_IDLE_MINUTES,
  SESSION_SECURITY_CHANGED_EVENT,
  SESSION_SECURITY_KEY,
  SessionSecurityAction,
  SessionSecuritySettings,
  normalizeIdleMinutes,
  normalizeSessionSecurity,
} from '@/api/model/session_security.ts';
import { Switch } from '@/components/common/input/switch.tsx';
import { Input } from '@/components/common/input/input.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { toast } from 'sonner';
import { useSecurity } from '@/hooks/useSecurity.ts';
import { useActionVisible } from '@/hooks/useActionVisible.ts';
import { cn, toRecordId } from '@/lib/utils.ts';

interface FormValues {
  enabled: boolean;
  idle_minutes: number;
  idle_action: SessionSecurityAction;
}

export const SessionSecuritySettingsCard = () => {
  const db = useDB();
  const [settings, setSettings] = useState<Setting>();
  const { protectFormSubmit } = useSecurity();
  const isVisible = useActionVisible();
  const canSave = isVisible('settings.session_security');
  const { t } = useTranslation(['settings', 'common']);

  const { control, handleSubmit, reset, watch } = useForm<FormValues>({
    defaultValues: {
      enabled: DEFAULT_SESSION_SECURITY.enabled,
      idle_minutes: DEFAULT_SESSION_SECURITY.idle_minutes,
      idle_action: DEFAULT_SESSION_SECURITY.idle_action,
    },
  });

  const enabled = watch('enabled');
  const idleAction = watch('idle_action');

  /** One establishment-wide row: the admin sets it for every user. */
  const loadSettings = useCallback(async () => {
    const [raw] = await db.query(
      `SELECT * FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1`,
      { key: SESSION_SECURITY_KEY }
    );
    const rows = (Array.isArray(raw) ? raw : []) as Setting[];
    setSettings(rows[0]);
  }, [db]);

  const saveSettings = async (values: FormValues) => {
    const payload: SessionSecuritySettings = {
      enabled: Boolean(values.enabled),
      idle_minutes: normalizeIdleMinutes(values.idle_minutes),
      idle_action: values.idle_action === 'logout' ? 'logout' : 'lock',
    };

    if (settings?.id) {
      await db.merge(toRecordId(settings.id), { values: payload });
    } else {
      await db.create(Tables.settings, {
        key: SESSION_SECURITY_KEY,
        is_global: true,
        values: payload,
      });
    }

    toast.success(t('settings:sessionSecurity.updated'));
    window.dispatchEvent(new Event(SESSION_SECURITY_CHANGED_EVENT));
    await loadSettings();
  };

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const values = normalizeSessionSecurity(
      (settings?.values ?? {}) as Partial<SessionSecuritySettings>
    );
    reset({
      enabled: values.enabled,
      idle_minutes: values.idle_minutes,
      idle_action: values.idle_action,
    });
  }, [settings, reset]);

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-session-security">
      <h2 className="text-xl font-semibold mb-1">{t('settings:sessionSecurity.title')}</h2>
      <p className="text-sm text-neutral-500 mb-5">
        {t('settings:sessionSecurity.description')}
      </p>
      <form
        onSubmit={protectFormSubmit(handleSubmit(saveSettings), {
          module: 'settings.session_security',
          description: t('settings:sessionSecurity.saveDescription'),
        })}
      >
        <div className="grid grid-cols-1 gap-5 mb-5">
          <Controller
            name="enabled"
            control={control}
            render={({ field }) => (
              <Switch checked={!!field.value} onChange={field.onChange}>
                {t('common:actions.enabled')}
              </Switch>
            )}
          />
          <Controller
            name="idle_minutes"
            control={control}
            rules={{
              required: enabled,
              min: MIN_IDLE_MINUTES,
            }}
            render={({ field }) => (
              <div>
                <Input
                  type="number"
                  min={MIN_IDLE_MINUTES}
                  step={0.1}
                  decimalScale={2}
                  allowNegative={false}
                  label={t('settings:sessionSecurity.idleMinutes')}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={!enabled}
                />
              </div>
            )}
          />
          <div>
            <label className="block font-bold mb-2">
              {t('settings:sessionSecurity.action')}
            </label>
            <Controller
              name="idle_action"
              control={control}
              render={({ field }) => (
                <div className="flex flex-wrap gap-3">
                  <Button
                    type="button"
                    disabled={!enabled}
                    variant={idleAction === 'lock' ? 'primary' : undefined}
                    className={cn(idleAction !== 'lock' && 'btn-light')}
                    onClick={() => field.onChange('lock')}
                  >
                    {t('settings:sessionSecurity.actionLock')}
                  </Button>
                  <Button
                    type="button"
                    disabled={!enabled}
                    variant={idleAction === 'logout' ? 'danger' : undefined}
                    className={cn(idleAction !== 'logout' && 'btn-light')}
                    onClick={() => field.onChange('logout')}
                  >
                    {t('settings:sessionSecurity.actionLogout')}
                  </Button>
                </div>
              )}
            />
          </div>
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
