import { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil, faPlus } from "@fortawesome/free-solid-svg-icons";
import useApi, { SettingsData } from "@/api/db/use.api.ts";
import { Tables } from "@/api/db/tables.ts";
import { Shift } from "@/api/model/shift.ts";
import { Button } from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { TableComponent } from "@/components/common/table/table.tsx";
import { ShiftForm } from "@/components/settings/users/shifts/shift.form.tsx";
import { shiftDisplayTime } from "@/lib/shift.utils.ts";
import {DeleteConfirm} from "@/components/common/table/delete.confirm.tsx";
import {useDB} from "@/api/db/db.ts";
import {useTranslation} from 'react-i18next';
import {executeSettingsDelete} from "@/lib/settings-delete.service.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {getAccessRuleChildLabel} from "@/lib/access.rules.i18n.ts";

export const AdminShifts = () => {
  const { t } = useTranslation(['admin', 'common', 'toast']);
  const loadHook = useApi<SettingsData<Shift>>(Tables.shifts, ["deleted_at = none"], ["name asc"]);
  const db = useDB();
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canUpdate = isVisible('admin.shifts.update');
  const canDelete = isVisible('admin.shifts.delete');
  const canCreate = isVisible('admin.shifts.create');
  const [data, setData] = useState<Shift>();
  const [formModal, setFormModal] = useState(false);

  const columnHelper = createColumnHelper<Shift>();

  const columns: any = [
    columnHelper.accessor("name", {
      header: t('columns.name'),
    }),
    columnHelper.accessor("start_time", {
      header: t('columns.shiftHours'),
      enableColumnFilter: false,
      cell: (info) => shiftDisplayTime(info.row.original),
    }),
    ...(canUpdate || canDelete ? [columnHelper.accessor("id", {
      id: "actions",
      header: t('columns.actions'),
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => (
        <div className="flex gap-3 items-center">
          {canUpdate ? (
            <IconTooltipButton label={t('common:actions.edit')}
              variant="primary"
              onClick={() => {
                protectAction(() => {
                  setData(info.row.original);
                  setFormModal(true);
                }, {
                  module: 'admin.shifts.update',
                  description: getAccessRuleChildLabel('admin.shifts.update'),
                });
              }}
            ><FontAwesomeIcon icon={faPencil} /></IconTooltipButton>
          ) : null}
          {canUpdate && canDelete ? <div className="separator"></div> : null}
          {canDelete ? (
            <DeleteConfirm
              message={t('delete.shift', { name: info.row.original.name })}
              onConfirm={() => protectAction(() => deleteItem(info.row.original.id), {
                module: 'admin.shifts.delete',
                description: getAccessRuleChildLabel('admin.shifts.delete'),
              })}
            />
          ) : null}
        </div>
      ),
    })] : []),
  ];

  const deleteItem = async (id: string) => {
    await executeSettingsDelete({
      db,
      id,
      entityLabel: t('entities.shift'),
      usageChecks: [
        {
          query: `SELECT count() AS count FROM ${Tables.users} WHERE user_shift = $idRecord GROUP ALL`
        }
      ],
      onAfter: async () => {
        loadHook.fetchData();
      }
    });
  };

  return (
    <>
      <TableComponent
        columns={columns}
        loaderHook={loadHook}
        loaderLineItems={columns.length}
        buttons={[
          canCreate ? (
            <Button
              variant="primary"
              onClick={() => {
                protectAction(() => {
                  setData(undefined);
                  setFormModal(true);
                }, {
                  module: 'admin.shifts.create',
                  description: getAccessRuleChildLabel('admin.shifts.create'),
                });
              }}
              icon={faPlus}
              data-testid="admin-add-shifts"
            >
              Shift
            </Button>
          ) : null,
        ].filter(Boolean)}
      />
      <ShiftForm
        open={formModal}
        data={data}
        onClose={() => {
          setFormModal(false);
          setData(undefined);
          loadHook.fetchData();
        }}
      />
    </>
  );
};
