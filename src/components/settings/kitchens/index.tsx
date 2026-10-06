import useApi, { SettingsData } from "@/api/db/use.api.ts";
import { Tables } from "@/api/db/tables.ts";
import { useEffect, useMemo, useState } from "react";
import { createColumnHelper } from "@tanstack/react-table";
import { Button } from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPencil, faPlus } from "@fortawesome/free-solid-svg-icons";
import { TableComponent } from "@/components/common/table/table.tsx";
import { Kitchen } from "@/api/model/kitchen.ts";
import { KitchenForm } from "@/components/settings/kitchens/kitchen.form.tsx";
import {DeleteConfirm} from "@/components/common/table/delete.confirm.tsx";
import {useDB} from "@/api/db/db.ts";
import {useTranslation} from 'react-i18next';
import {executeSettingsDelete} from "@/lib/settings-delete.service.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {getAccessRuleChildLabel} from "@/lib/access.rules.i18n.ts";
import {DataImportModal} from "@/components/common/data-import/data-import-modal.tsx";
import {AiSparklesIcon} from "@/components/common/icons/ai-sparkles.tsx";
import {createKitchenImportConfig} from "@/components/settings/kitchens/kitchen.import.config.ts";
import {ensureStationAccounts, removeStationAccount, StationAccount} from "@/lib/kitchen/station-account.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {toast} from "sonner";

export const AdminKitchens = () => {
  const { t } = useTranslation(['admin', 'common', 'toast']);
  const loadHook = useApi<SettingsData<Kitchen>>(Tables.kitchens, ['deleted_at = none'], ['priority asc'], 0, 10, ['items', 'printers', 'outlet']);
  const db = useDB();
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canUpdate = isVisible('admin.kitchens.update');
  const canDelete = isVisible('admin.kitchens.delete');
  const canCreate = isVisible('admin.kitchens.create');
  const canImport = isVisible('admin.kitchens.import');

  const [data, setData] = useState<Kitchen>();
  const [formModal, setFormModal] = useState(false);
  const [importModal, setImportModal] = useState(false);

  // Every station gets its account here; the PIN is shown so it can be typed on the tablet.
  const [stationAccounts, setStationAccounts] = useState<Record<string, StationAccount>>({});
  const refreshStationAccounts = async () => {
    try {
      setStationAccounts(await ensureStationAccounts(db));
    } catch (error) {
      console.error('Station accounts failed', error);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    void refreshStationAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount; db identity changes every render
  }, []);

  const smartImportConfig = useMemo(
    () => createKitchenImportConfig({db, t}),
    [db, t]
  );

  const columnHelper = createColumnHelper<Kitchen>();

  const columns: any = [
    columnHelper.accessor("name", {
      header: t('columns.name'),
      cell: info => (
        <span className="flex items-center gap-2">
          {info.getValue()}
          {info.row.original.shows_all ? (
            <span className="tag">{t('forms.showsAllBadge')}</span>
          ) : null}
        </span>
      )
    }),
    columnHelper.accessor("printers", {
      header: t('columns.printers'),
      cell: info => info.getValue()?.filter((item): item is NonNullable<typeof item> => !!item)?.map(item => <span className="tag" key={item.id}>{item?.name}</span>)
    }),
    columnHelper.accessor("priority", {
      header: t('columns.priority')
    }),
    columnHelper.display({
      id: "station_account",
      header: t('columns.stationAccount'),
      cell: info => {
        const account = stationAccounts[recordIdToString(info.row.original.id)];
        return account ? <span className="tag">{account.login}</span> : '-';
      }
    }),
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
                    module: 'admin.kitchens.update',
                    description: getAccessRuleChildLabel('admin.kitchens.update'),
                  });
                }}
              ><FontAwesomeIcon icon={faPencil}/></IconTooltipButton>
            ) : null}
            {canUpdate && canDelete ? <div className="separator"></div> : null}
            {canDelete ? (
              <DeleteConfirm
                message={t('delete.kitchen', { name: info.row.original.name })}
                onConfirm={() => protectAction(() => deleteItem(info.row.original.id), {
                  module: 'admin.kitchens.delete',
                  description: getAccessRuleChildLabel('admin.kitchens.delete'),
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
      entityLabel: t('entities.kitchen'),
      usageChecks: [
        {
          query: `SELECT count() AS count FROM ${Tables.order_items_kitchen} WHERE kitchen = $idRecord GROUP ALL`
        },
        {
          query: `SELECT count() AS count FROM ${Tables.workflow_stages} WHERE kitchen = $idRecord GROUP ALL`
        }
      ],
      onAfter: async () => {
        await removeStationAccount(db, id);
        loadHook.fetchData();
        void refreshStationAccounts();
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
          canImport ? <Button variant="primary" onClick={() => {
            protectAction(() => setImportModal(true), {
              module: 'admin.kitchens.import',
              description: getAccessRuleChildLabel('admin.kitchens.import'),
            });
          }}><span className="mr-2"><AiSparklesIcon /></span>{t('buttons.smartImport')}</Button> : null,
          canCreate ? <Button variant="primary" onClick={() => {
            protectAction(() => {
              setData(undefined);
              setFormModal(true);
            }, {
              module: 'admin.kitchens.create',
              description: getAccessRuleChildLabel('admin.kitchens.create'),
            });
          }} icon={faPlus} data-testid="admin-add-kitchens">{t('buttons.kitchen')}</Button> : null,
        ].filter(Boolean)}
      />

      {importModal && (
        <DataImportModal
          isOpen
          onClose={() => setImportModal(false)}
          config={smartImportConfig}
          title={t('forms.smartImportKitchensTitle', {defaultValue: 'AI Import kitchens'})}
          enableImportModes
          defaultMatchFields={['name']}
          onExport={async () => {
            const [rows] = await db.query(
              `SELECT * FROM ${Tables.kitchens} WHERE deleted_at = none FETCH items, printers`
            );
            return (rows as Kitchen[]).map((row) => ({
              name: row.name ?? '',
              priority: String(row.priority ?? ''),
              items: (row.items ?? []).filter(Boolean).map((item) => item?.name).filter(Boolean).join('|'),
              printers: (row.printers ?? []).filter(Boolean).map((item) => item?.name).filter(Boolean).join('|'),
              shows_all: row.shows_all ? 'true' : 'false',
            }));
          }}
          onDone={() => {
            loadHook.fetchData();
            void refreshStationAccounts();
          }}
        />
      )}

      {formModal && (
        <KitchenForm
          open={formModal}
          data={data}
          onClose={() => {
            setFormModal(false);
            setData(undefined);
            loadHook.fetchData();
            void refreshStationAccounts();
          }}
        />
      )}

    </>
  )
}
