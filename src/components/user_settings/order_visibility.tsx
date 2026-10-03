import {FormEvent, useEffect, useState} from "react";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {Setting} from "@/api/model/setting.ts";
import {UserRole} from "@/api/model/user_role.ts";
import {Switch} from "@/components/common/input/switch.tsx";
import {toast} from "sonner";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {useTranslation} from "react-i18next";
import {
  DEFAULT_ORDER_VISIBILITY,
  ORDER_VISIBILITY_KEY,
  OrderVisibilitySettings,
  SEES_ALL_ORDERS_MODULE,
  withSeeAllOrders,
} from "@/api/model/order_visibility.ts";

/**
 * Manage → General settings: one switch for "each user sees only their own orders", and the
 * roles that still see every order (the `order_visibility.all` permission), in one place.
 */
export const OrderVisibilitySettingsCard = () => {
  const db = useDB();
  const {protectFormSubmit} = useSecurity();
  const isVisible = useActionVisible();
  // Saving edits role permissions: the same right as the role editor.
  const canSave = isVisible('admin.users');
  const {t} = useTranslation(["settings", "common"]);

  const [setting, setSetting] = useState<Setting>();
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [ownOrdersOnly, setOwnOrdersOnly] = useState(DEFAULT_ORDER_VISIBILITY.own_orders_only);
  const [seesAll, setSeesAll] = useState<Record<string, boolean>>({});

  const load = async () => {
    const [settingRows, roleRows] = await db.query<[Setting[], UserRole[]]>(
      `SELECT * FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1;
       SELECT * FROM ${Tables.user_roles} WHERE deleted_at = NONE ORDER BY name`,
      {key: ORDER_VISIBILITY_KEY},
    );
    const row = settingRows?.[0];
    const values = {...DEFAULT_ORDER_VISIBILITY, ...(row?.values as OrderVisibilitySettings | undefined)};
    setSetting(row);
    setOwnOrdersOnly(Boolean(values.own_orders_only));
    setRoles(roleRows ?? []);
    setSeesAll(Object.fromEntries(
      (roleRows ?? []).map(role => [role.id.toString(), (role.roles ?? []).includes(SEES_ALL_ORDERS_MODULE)]),
    ));
  };

  const save = async () => {
    const payload: OrderVisibilitySettings = {own_orders_only: ownOrdersOnly};
    if (setting?.id) {
      await db.merge(setting.id, {values: payload});
    } else {
      await db.create(Tables.settings, {key: ORDER_VISIBILITY_KEY, is_global: true, values: payload});
    }

    for (const role of roles) {
      const wanted = !!seesAll[role.id.toString()];
      if (wanted !== (role.roles ?? []).includes(SEES_ALL_ORDERS_MODULE)) {
        await db.merge(role.id, {roles: withSeeAllOrders(role.roles, wanted)});
      }
    }

    toast.success(t("settings:orderVisibility.updated"));
    await load();
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-order-visibility">
      <h2 className="text-xl font-semibold mb-1">{t("settings:orderVisibility.title")}</h2>
      <p className="text-sm text-neutral-500 mb-5">{t("settings:orderVisibility.description")}</p>
      <form
        onSubmit={protectFormSubmit(() => void save(), {
          module: "admin.users",
          description: t("settings:orderVisibility.saveDescription"),
        })}
      >
        <div className="mb-5">
          <Switch
            checked={ownOrdersOnly}
            onChange={(event) => setOwnOrdersOnly(event.currentTarget.checked)}
            data-testid="order-visibility-own-only"
          >
            {t("settings:orderVisibility.ownOrdersOnly")}
          </Switch>
        </div>

        <div className={ownOrdersOnly ? "mb-5" : "mb-5 opacity-50"}>
          <p className="font-semibold mb-2">{t("settings:orderVisibility.rolesTitle")}</p>
          <div className="flex flex-col gap-2" data-testid="order-visibility-roles">
            {roles.map(role => (
              <Switch
                key={role.id.toString()}
                checked={!!seesAll[role.id.toString()]}
                disabled={!ownOrdersOnly}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setSeesAll(prev => ({...prev, [role.id.toString()]: checked}));
                }}
              >
                {role.name}
              </Switch>
            ))}
          </div>
        </div>

        {canSave && (
          <button className="btn btn-primary" type="submit">
            {t("common:actions.save")}
          </button>
        )}
      </form>
    </div>
  );
};
