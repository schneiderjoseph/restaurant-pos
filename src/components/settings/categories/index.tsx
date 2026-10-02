import {useMemo, useState} from "react";
import {Tables} from "@/api/db/tables.ts";
import {Category} from "@/api/model/category.ts";
import {Dish} from "@/api/model/dish.ts";
import {Kitchen, KITCHEN_FETCHES} from "@/api/model/kitchen.ts";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {createColumnHelper, RowSelectionState} from "@tanstack/react-table";
import {Button} from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faCheck, faPencil, faPlus, faTimes} from "@fortawesome/free-solid-svg-icons";
import {TableComponent} from "@/components/common/table/table.tsx";
import {CategoryForm} from "@/components/settings/categories/category.form.tsx";
import {CategoryBulkForm} from "@/components/settings/categories/category.bulk.form.tsx";
import {OutletsManage} from "@/components/settings/categories/outlets.manage.tsx";
import {DeleteConfirm} from "@/components/common/table/delete.confirm.tsx";
import {useDB} from "@/api/db/db.ts";
import {DataImportModal} from "@/components/common/data-import/data-import-modal.tsx";
import {AiSparklesIcon} from "@/components/common/icons/ai-sparkles.tsx";
import {createCategoryImportConfig} from "@/components/settings/categories/category.import.config.ts";
import {Checkbox} from "@/components/common/input/checkbox";
import {useTranslation} from 'react-i18next';
import {executeSettingsDelete} from "@/lib/settings-delete.service.ts";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {getAccessRuleChildLabel} from "@/lib/access.rules.i18n.ts";
import {Modal} from "@/components/common/react-aria/modal.tsx";
import {suggestOutlet} from "@/lib/outlet.ts";
import {toRecordId} from "@/lib/utils.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {toast} from "sonner";

export const AdminCategories = () => {
  const { t } = useTranslation(['admin', 'common', 'toast']);
  const loadHook = useApi<SettingsData<Category>>(Tables.categories, ['deleted_at = none'], [], undefined, undefined, ['outlet']);
  const db = useDB();
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canEdit = isVisible('admin.categories.update');
  const canDelete = isVisible('admin.categories.delete');
  const canImport = isVisible('admin.categories.import');
  const canCreate = isVisible('admin.categories.create');

  const [data, setData] = useState<Category>();
  const [formModal, setFormModal] = useState(false);
  const [outletsModal, setOutletsModal] = useState(false);
  const [applySuggestionsOpen, setApplySuggestionsOpen] = useState(false);
  const [applySuggestionsCount, setApplySuggestionsCount] = useState(0);
  const [applySuggestionsLoading, setApplySuggestionsLoading] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [bulkEdit, setBulkEdit] = useState({
    state: false,
    data: [] as Category[]
  });
  const [importModal, setImportModal] = useState(false);

  const smartImportConfig = useMemo(
    () => createCategoryImportConfig({db, t}),
    [db, t]
  );

  const columnHelper = createColumnHelper<Category>();

  const columns: any = [
    {
      id: 'select-col',
      header: ({table}) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          indeterminate={table.getIsSomeRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()}
        />
      ),
      cell: ({row}) => (
        <Checkbox
          checked={row.getIsSelected()}
          disabled={!row.getCanSelect()}
          onChange={row.getToggleSelectedHandler()}
        />
      ),
    },
    columnHelper.accessor("name", {
      header: t('columns.name')
    }),
    columnHelper.accessor("show_in_menu", {
      header: t('columns.showInMenu'),
      cell: info => info.getValue() ? <FontAwesomeIcon icon={faCheck} className="text-success-500"/> :
        <FontAwesomeIcon icon={faTimes} className="text-danger-500"/>
    }),
    columnHelper.accessor("priority", {
      header: t('columns.priority')
    }),
    ...(canEdit || canDelete ? [columnHelper.accessor("id", {
      id: "actions",
      header: t('columns.actions'),
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => {
        return (
          <div className="flex gap-3 items-center">
            {canEdit && (
              <IconTooltipButton label={t('common:actions.edit')}
                variant="primary"
                onClick={() => {
                  protectAction(() => {
                    setData(info.row.original);
                    setFormModal(true);
                  }, {
                    module: 'admin.categories.update',
                    description: getAccessRuleChildLabel('admin.categories.update'),
                  });
                }}
              ><FontAwesomeIcon icon={faPencil}/></IconTooltipButton>
            )}
            {canEdit && canDelete && <div className="separator"></div>}
            {canDelete && (
              <DeleteConfirm message={t('delete.category', { name: info.row.original.name })} onConfirm={() => protectAction(async () => {
                await executeSettingsDelete({
                  db,
                  id: info.row.original.id,
                  entityLabel: t('entities.category'),
                  usageChecks: [
                    {
                      query: `SELECT count() AS count FROM ${Tables.dishes} WHERE categories ?= $idRecord AND deleted_at = none GROUP ALL`
                    }
                  ],
                  onAfter: async () => {
                    loadHook.fetchData();
                  }
                });
              }, {
                module: 'admin.categories.delete',
                description: getAccessRuleChildLabel('admin.categories.delete'),
              })}/>
            )}
          </div>
        );
      },
    })] : []),
  ];

  const openApplySuggestions = async () => {
    protectAction(async () => {
      const [[categories], [dishes], [kitchens]] = await Promise.all([
        db.query(`SELECT * FROM ${Tables.categories} WHERE deleted_at = none FETCH outlet`),
        db.query(`SELECT id, categories FROM ${Tables.dishes} WHERE deleted_at = none FETCH categories`),
        db.query(`SELECT items, outlet FROM ${Tables.kitchens} WHERE deleted_at = none FETCH ${KITCHEN_FETCHES.join(', ')}`),
      ]) as [[Category[]], [Dish[]], [Kitchen[]]];

      const pending = (categories ?? []).filter((category) => {
        if (recordIdToString(category.parent)) return false;
        if (recordIdToString(category.outlet)) return false;
        return !!suggestOutlet(category.id, categories ?? [], dishes ?? [], kitchens ?? []);
      });

      setApplySuggestionsCount(pending.length);
      setApplySuggestionsOpen(true);
    }, {
      module: 'admin.categories.update',
      description: getAccessRuleChildLabel('admin.categories.update'),
    });
  };

  const confirmApplySuggestions = async () => {
    setApplySuggestionsLoading(true);
    try {
      const [[categories], [dishes], [kitchens]] = await Promise.all([
        db.query(`SELECT * FROM ${Tables.categories} WHERE deleted_at = none FETCH outlet`),
        db.query(`SELECT id, categories FROM ${Tables.dishes} WHERE deleted_at = none FETCH categories`),
        db.query(`SELECT items, outlet FROM ${Tables.kitchens} WHERE deleted_at = none FETCH ${KITCHEN_FETCHES.join(', ')}`),
      ]) as [[Category[]], [Dish[]], [Kitchen[]]];

      let applied = 0;
      for (const category of categories ?? []) {
        if (recordIdToString(category.parent)) continue;
        if (recordIdToString(category.outlet)) continue;
        const suggested = suggestOutlet(category.id, categories ?? [], dishes ?? [], kitchens ?? []);
        if (!suggested) continue;
        await db.merge(category.id, { outlet: toRecordId(suggested.id) });
        applied += 1;
      }

      toast.success(t('toast:admin.outletSuggestionsApplied', { count: applied }));
      setApplySuggestionsOpen(false);
      loadHook.fetchData();
    } catch (e) {
      toast.error(e);
      console.log(e);
    } finally {
      setApplySuggestionsLoading(false);
    }
  };

  return (
    <>
      <TableComponent
        columns={columns}
        loaderHook={loadHook}
        loaderLineItems={columns.length}
        buttons={[
          ...((canEdit || canCreate) ? [
            <Button key="manage-outlets" variant="primary" onClick={() => {
              protectAction(() => setOutletsModal(true), {
                module: canEdit ? 'admin.categories.update' : 'admin.categories.create',
                description: getAccessRuleChildLabel(canEdit ? 'admin.categories.update' : 'admin.categories.create'),
              });
            }}>{t('buttons.manageOutlets')}</Button>,
          ] : []),
          ...(canEdit ? [
            <Button key="apply-suggestions" variant="primary" onClick={() => {
              void openApplySuggestions();
            }}>{t('buttons.applyOutletSuggestions')}</Button>,
          ] : []),
          ...(canImport ? [
            <Button key="import" variant="primary" onClick={() => {
              protectAction(() => setImportModal(true), {
                module: 'admin.categories.import',
                description: getAccessRuleChildLabel('admin.categories.import'),
              });
            }}><span className="mr-2"><AiSparklesIcon /></span>{t('buttons.smartImport')}</Button>,
          ] : []),
          ...(canCreate ? [
            <Button key="create" variant="primary" onClick={() => {
              protectAction(() => {
                setData(undefined);
                setFormModal(true);
              }, {
                module: 'admin.categories.create',
                description: getAccessRuleChildLabel('admin.categories.create'),
              });
            }} icon={faPlus} data-testid="admin-add-categories">{t('buttons.category')}</Button>,
          ] : []),
        ]}
        enableSelection
        rowSelection={rowSelection}
        onRowSelectionChange={(selectionState, selectedRows) => {
          setRowSelection(selectionState);
          setBulkEdit((prev) => ({
            ...prev,
            data: selectedRows as Category[],
          }));
        }}
        selectionButtons={canEdit ? [
          <Button key="bulk-edit" variant="primary" onClick={() => {
            protectAction(() => {
              setBulkEdit((prev) => ({
                ...prev,
                state: true,
              }));
            }, {
              module: 'admin.categories.update',
              description: getAccessRuleChildLabel('admin.categories.update'),
            });
          }} icon={faPencil}>{t('buttons.bulkEdit')}</Button>
        ] : []}
      />

      {importModal && (
        <DataImportModal
          isOpen
          onClose={() => setImportModal(false)}
          config={smartImportConfig}
          title={t('forms.smartImportCategoriesTitle')}
          enableImportModes
          defaultMatchFields={['name']}
          onExport={async () => {
            const [categories] = await db.query(
              `SELECT * FROM ${Tables.categories} WHERE deleted_at = none`
            );
            return (categories as Category[]).map((row) => ({
              name: row.name ?? '',
              show_in_menu: row.show_in_menu ? 'true' : 'false',
              priority: String(row.priority ?? ''),
            }));
          }}
          onDone={() => loadHook.fetchData()}
        />
      )}

      {formModal && (
        <CategoryForm
          open={formModal}
          data={data}
          onClose={() => {
            setFormModal(false);
            setData(undefined);
            loadHook.fetchData();
          }}
        />
      )}

      {outletsModal && (
        <OutletsManage
          open={outletsModal}
          onClose={() => setOutletsModal(false)}
        />
      )}

      {applySuggestionsOpen && (
        <Modal
          open={applySuggestionsOpen}
          onClose={() => !applySuggestionsLoading && setApplySuggestionsOpen(false)}
          title={t('forms.applyOutletSuggestionsTitle')}
          size="sm"
        >
          <p className="text-neutral-600 mb-4">
            {t('forms.applyOutletSuggestionsConfirm', { count: applySuggestionsCount })}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setApplySuggestionsOpen(false)}
              disabled={applySuggestionsLoading}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              variant="primary"
              onClick={() => void confirmApplySuggestions()}
              isLoading={applySuggestionsLoading}
              disabled={applySuggestionsLoading || applySuggestionsCount === 0}
            >
              {t('common:actions.confirm')}
            </Button>
          </div>
        </Modal>
      )}

      {bulkEdit.state && (
        <CategoryBulkForm
          open={bulkEdit.state}
          data={bulkEdit.data}
          onClose={() => {
            setBulkEdit({
              state: false,
              data: []
            });
            setRowSelection({});
            loadHook.fetchData();
          }}
        />
      )}
    </>
  )
}
