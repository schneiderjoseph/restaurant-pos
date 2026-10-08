import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Tables} from "@/api/db/tables.ts";
import {useEffect, useState} from "react";
import {useDB} from "@/api/db/db.ts";
import {createColumnHelper} from "@tanstack/react-table";
import {Button} from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faPencil} from "@fortawesome/free-solid-svg-icons";
import {TableComponent} from "@/components/common/table/table.tsx";
import {Setting} from "@/api/model/setting.ts";
import {useTranslation} from 'react-i18next';
import {PrintForm} from "@/components/settings/prints/print.form.tsx";
import {useSecurity} from "@/hooks/useSecurity.ts";
import {useActionVisible} from "@/hooks/useActionVisible.ts";
import {getAccessRuleChildLabel} from "@/lib/access.rules.i18n.ts";

// Same keys as print.service.ts PRINT_CONFIG_KEYS. Bills show line prices by default,
// like the print server does when the template has no row.
const PRINT_TEMPLATES: { key: string; bill: boolean }[] = [
  {key: 'Temp Print', bill: true},
  {key: 'Final Print', bill: true},
  {key: 'Delivery Print', bill: true},
  {key: 'Kitchen Print', bill: false},
  {key: 'Deletion Print', bill: false},
  {key: 'Summary Print', bill: false},
];

const keyFilter = `(${PRINT_TEMPLATES.map(({key}) => `key = "${key}"`).join(' or ')})`;

export const AdminPrints = () => {
  const { t } = useTranslation(['admin', 'common', 'toast']);
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canUpdate = isVisible('admin.print_settings.update');
  const db = useDB();
  const loadHook = useApi<SettingsData<Setting>>(Tables.settings, [keyFilter], ['priority asc']);

  // Templates only appear once a row exists: create the missing ones so they can be edited.
  useEffect(() => {
    if (!canUpdate) return;
    let cancelled = false;
    (async () => {
      try {
        const [res] = await db.query(
          `SELECT key FROM ${Tables.settings} WHERE is_global = true AND ${keyFilter}`
        );
        const existing = new Set((Array.isArray(res) ? res : []).map((r: { key: string }) => r.key));
        const missing = PRINT_TEMPLATES.filter(({key}) => !existing.has(key));
        if (missing.length === 0 || cancelled) return;
        for (const {key, bill} of missing) {
          await db.create(Tables.settings, {
            key,
            is_global: true,
            values: {
              showItemName: true,
              showItemQuantity: true,
              showItemPrice: bill,
              showItemTotal: bill,
            },
          });
        }
        if (!cancelled) loadHook.fetchData();
      } catch (e) {
        console.error('Failed to create missing print settings', e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUpdate]);

  const [data, setData] = useState<Setting>();
  const [formModal, setFormModal] = useState(false);

  const columnHelper = createColumnHelper<Setting>();

  const columns: any = [
    columnHelper.accessor("key", {
      header: t('columns.name')
    }),
    ...(canUpdate ? [columnHelper.accessor("id", {
      id: "actions",
      header: t('columns.actions'),
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => {
        return (
          <>
            <IconTooltipButton label={t('common:actions.edit')}
              variant="primary"
              data-testid="admin-edit-print-setting"
              onClick={() => {
                protectAction(() => {
                  setData(info.row.original);
                  setFormModal(true);
                }, {
                  module: 'admin.print_settings.update',
                  description: getAccessRuleChildLabel('admin.print_settings.update'),
                });
              }}
            ><FontAwesomeIcon icon={faPencil}/></IconTooltipButton>
          </>
        );
      },
    })] : []),
  ];

  return (
    <>
      <TableComponent
        columns={columns}
        loaderHook={loadHook}
        loaderLineItems={columns.length}
        buttons={[]}
      />

      {formModal && (
        <PrintForm
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