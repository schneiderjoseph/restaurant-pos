import { useState } from "react";
import { Tables } from "@/api/db/tables.ts";
import { Outlet } from "@/api/model/outlet.ts";
import useApi, { SettingsData } from "@/api/db/use.api.ts";
import { Modal } from "@/components/common/react-aria/modal.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil, faPlus } from "@fortawesome/free-solid-svg-icons";
import { DeleteConfirm } from "@/components/common/table/delete.confirm.tsx";
import { OutletForm } from "@/components/settings/categories/outlet.form.tsx";
import { useDB } from "@/api/db/db.ts";
import { useTranslation } from "react-i18next";
import { useSecurity } from "@/hooks/useSecurity.ts";
import { useActionVisible } from "@/hooks/useActionVisible.ts";
import { getAccessRuleChildLabel } from "@/lib/access.rules.i18n.ts";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
}

export const OutletsManage = ({ open, onClose }: Props) => {
  const { t } = useTranslation(["admin", "common", "toast"]);
  const db = useDB();
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canEdit = isVisible("admin.categories.update");
  const canDelete = isVisible("admin.categories.delete");
  const canCreate = isVisible("admin.categories.create");

  const loadHook = useApi<SettingsData<Outlet>>(
    Tables.outlets,
    ["deleted_at = none"],
    ["priority asc"],
    0,
    99999,
    [],
    { enabled: open },
  );

  const [data, setData] = useState<Outlet>();
  const [formModal, setFormModal] = useState(false);

  const outlets = loadHook.data?.data ?? [];

  return (
    <>
      <Modal
        testId="admin-manage-outlets"
        title={t("forms.manageOutlets")}
        open={open}
        onClose={onClose}
      >
        <div className="space-y-3">
          <div className="flex justify-end">
            {canCreate && (
              <Button
                variant="primary"
                icon={faPlus}
                onClick={() => {
                  protectAction(() => {
                    setData(undefined);
                    setFormModal(true);
                  }, {
                    module: "admin.categories.create",
                    description: getAccessRuleChildLabel("admin.categories.create"),
                  });
                }}
                data-testid="admin-add-outlet"
              >
                {t("buttons.outlet")}
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <table className="min-w-full divide-y divide-neutral-200">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="py-2 pl-3 pr-2 text-left text-sm font-semibold text-neutral-700">
                    {t("columns.name")}
                  </th>
                  <th className="py-2 px-2 text-left text-sm font-semibold text-neutral-700">
                    {t("columns.priority")}
                  </th>
                  <th className="py-2 px-2 text-left text-sm font-semibold text-neutral-700">
                    {t("columns.color")}
                  </th>
                  {(canEdit || canDelete) && (
                    <th className="py-2 pr-3 pl-2 text-left text-sm font-semibold text-neutral-700">
                      {t("columns.actions")}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {outlets.map((outlet) => (
                  <tr key={String(outlet.id)}>
                    <td className="py-2 pl-3 pr-2 text-sm text-neutral-800">{outlet.name}</td>
                    <td className="py-2 px-2 text-sm text-neutral-700">{outlet.priority}</td>
                    <td className="py-2 px-2 text-sm">
                      {outlet.color ? (
                        <span
                          className="inline-block h-5 w-5 rounded border border-neutral-300"
                          style={{ backgroundColor: outlet.color }}
                          title={outlet.color}
                          aria-label={outlet.color}
                        />
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                    {(canEdit || canDelete) && (
                      <td className="py-2 pr-3 pl-2">
                        <div className="flex gap-2 items-center">
                          {canEdit && (
                            <IconTooltipButton
                              label={t("common:actions.edit")}
                              variant="primary"
                              onClick={() => {
                                protectAction(() => {
                                  setData(outlet);
                                  setFormModal(true);
                                }, {
                                  module: "admin.categories.update",
                                  description: getAccessRuleChildLabel("admin.categories.update"),
                                });
                              }}
                            >
                              <FontAwesomeIcon icon={faPencil} />
                            </IconTooltipButton>
                          )}
                          {canDelete && (
                            <DeleteConfirm
                              message={t("delete.outlet", { name: outlet.name })}
                              onConfirm={() => protectAction(async () => {
                                await db.merge(outlet.id, { deleted_at: new Date() });
                                toast.success(t("toast:admin.outletDeleted", { name: outlet.name }));
                                loadHook.fetchData();
                              }, {
                                module: "admin.categories.delete",
                                description: getAccessRuleChildLabel("admin.categories.delete"),
                              })}
                            />
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {outlets.length === 0 && (
                  <tr>
                    <td
                      colSpan={canEdit || canDelete ? 4 : 3}
                      className="py-4 text-center text-sm text-neutral-500"
                    >
                      {t("forms.noOutlets")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {formModal && (
        <OutletForm
          open={formModal}
          data={data}
          onClose={() => {
            setFormModal(false);
            setData(undefined);
            loadHook.fetchData();
          }}
        />
      )}
    </>
  );
};
