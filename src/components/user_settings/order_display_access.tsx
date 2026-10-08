import {useCallback, useEffect, useState} from "react";
import {useDB} from "@/api/db/db.ts";
import {Tables} from "@/api/db/tables.ts";
import {UserRole} from "@/api/model/user_role.ts";
import {Switch} from "@/components/common/input/switch.tsx";
import {toast} from "sonner";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {useTranslation} from "react-i18next";

/** Permission that opens the order display screen (sidebar + route guard). */
const ORDER_DISPLAY_MODULE = 'order_display';

/**
 * Manage → General settings: the roles that can open the order display screen, in one
 * place (the same `order_display` permission as the role editor). What a role sees there
 * follows the order visibility card.
 */
export const OrderDisplayAccessSettingsCard = () => {
  const db = useDB();
  const {protectFormSubmit} = useSecurity();
  const isVisible = useActionVisible();
  // Saving edits role permissions: the same right as the role editor.
  const canSave = isVisible('admin.users');
  const {t} = useTranslation(["settings", "common"]);

  const [roles, setRoles] = useState<UserRole[]>([]);
  const [hasAccess, setHasAccess] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const [roleRows] = await db.query<[UserRole[]]>(
      `SELECT * FROM ${Tables.user_roles} WHERE deleted_at = NONE ORDER BY name`,
    );
    setRoles(roleRows ?? []);
    setHasAccess(Object.fromEntries(
      (roleRows ?? []).map(role => [role.id.toString(), (role.roles ?? []).includes(ORDER_DISPLAY_MODULE)]),
    ));
  }, [db]);

  const save = async () => {
    for (const role of roles) {
      const wanted = !!hasAccess[role.id.toString()];
      if (wanted !== (role.roles ?? []).includes(ORDER_DISPLAY_MODULE)) {
        const without = (role.roles ?? []).filter(module => module !== ORDER_DISPLAY_MODULE);
        await db.merge(role.id, {roles: wanted ? [...without, ORDER_DISPLAY_MODULE] : without});
      }
    }

    toast.success(t("settings:orderDisplayAccess.updated"));
    await load();
  };

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-order-display-access">
      <h2 className="text-xl font-semibold mb-1">{t("settings:orderDisplayAccess.title")}</h2>
      <p className="text-sm text-neutral-500 mb-5">{t("settings:orderDisplayAccess.description")}</p>
      <form
        onSubmit={protectFormSubmit(() => void save(), {
          module: "admin.users",
          description: t("settings:orderDisplayAccess.saveDescription"),
        })}
      >
        <div className="mb-5">
          <p className="font-semibold mb-2">{t("settings:orderDisplayAccess.rolesTitle")}</p>
          <div className="flex flex-col gap-2" data-testid="order-display-access-roles">
            {roles.map(role => (
              <Switch
                key={role.id.toString()}
                checked={!!hasAccess[role.id.toString()]}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setHasAccess(prev => ({...prev, [role.id.toString()]: checked}));
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
