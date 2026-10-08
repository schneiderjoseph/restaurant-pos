import useApi, { SettingsData } from "@/api/db/use.api.ts";
import { Tables } from "@/api/db/tables.ts";
import { useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Button } from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil, faPlus } from "@fortawesome/free-solid-svg-icons";
import { TableComponent } from "@/components/common/table/table.tsx";
import { Printer } from "@/api/model/printer.ts";
import { PrinterForm } from "@/components/settings/printers/printer.form.tsx";
import {DeleteConfirm} from "@/components/common/table/delete.confirm.tsx";
import {useDB} from "@/api/db/db.ts";
import {useTranslation} from 'react-i18next';
import {executeSettingsDelete} from "@/lib/settings-delete.service.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {getAccessRuleChildLabel} from "@/lib/access.rules.i18n.ts";

export const AdminPrinters = () => {
  const { t } = useTranslation(['admin', 'common', 'toast']);
  const loadHook = useApi<SettingsData<Printer>>(Tables.printers, ['deleted_at = none'], ['priority asc']);
  const db = useDB();
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canUpdate = isVisible('admin.printers.update');
  const canDelete = isVisible('admin.printers.delete');
  const canCreate = isVisible('admin.printers.create');

  const [data, setData] = useState<Printer>();
  const [formModal, setFormModal] = useState(false);

  const columnHelper = createColumnHelper<Printer>();

  const columns: any = [
    columnHelper.accessor("name", {
      header: t('columns.name')
    }),
    columnHelper.accessor("type", {
      header: t('columns.type'),
      cell: info => {
        const value = info.getValue();
        return value ? t(`forms.printerTypes.${String(value).toLowerCase()}`) : value;
      }
    }),
    columnHelper.accessor("ip_address", {
      header: t('columns.path')
    }),
    columnHelper.accessor("port", {
      header: t('columns.port')
    }),
    // columnHelper.accessor("priority", {
    //   header: t('columns.priority')
    // }),
    ...(canUpdate || canDelete ? [columnHelper.accessor("id", {
      id: "actions",
      header: t('columns.actions'),
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => {
        return (
          <div className="flex gap-3 items-center">
            {canUpdate ? (
              <IconTooltipButton label={t('common:actions.edit')}
                variant="primary"
                onClick={() => {
                  protectAction(() => {
                    setData(info.row.original);
                    setFormModal(true);
                  }, {
                    module: 'admin.printers.update',
                    description: getAccessRuleChildLabel('admin.printers.update'),
                  });
                }}
              ><FontAwesomeIcon icon={faPencil}/></IconTooltipButton>
            ) : null}
            {canUpdate && canDelete ? <div className="separator"></div> : null}
            {canDelete ? (
              <DeleteConfirm
                message={t('delete.printer', { name: info.row.original.name })}
                onConfirm={() => protectAction(() => deleteItem(info.row.original.id), {
                  module: 'admin.printers.delete',
                  description: getAccessRuleChildLabel('admin.printers.delete'),
                })}
              />
            ) : null}
          </div>
        );
      },
    })] : []),
  ];

  const deleteItem = async (id: string) => {
    await executeSettingsDelete({
      db,
      id,
      entityLabel: t('entities.printer'),
      usageChecks: [
        {
          query: `SELECT count() AS count FROM ${Tables.kitchens} WHERE printers ?= $idRecord GROUP ALL`
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
          canCreate ? <Button variant="primary" onClick={() => {
            protectAction(() => {
              setData(undefined);
              setFormModal(true);
            }, {
              module: 'admin.printers.create',
              description: getAccessRuleChildLabel('admin.printers.create'),
            });
          }} icon={faPlus} data-testid="admin-add-printers">{t('buttons.printer')}</Button> : null,
        ].filter(Boolean)}
      />

      {formModal && (
        <PrinterForm
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
  )
}
