import { useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faCodeMerge,
  faCrown,
  faEye,
  faPencil,
  faPlus,
  faRotateLeft,
  faSliders,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import useApi, { SettingsData } from '@/api/db/use.api.ts';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { TableComponent } from '@/components/common/table/table.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { IconTooltipButton } from '@/components/common/input/icon.tooltip.button.tsx';
import { QuickCreateCustomerModal } from '@/components/customer/quick.create.modal.tsx';
import { CustomerPreferencesForm } from '@/components/customer/customer.preferences.form.tsx';
import { CustomerDetail } from '@/components/settings/customers/customer.detail.tsx';
import { CustomerForm } from '@/components/settings/customers/customer.form.tsx';
import { CustomerDeleteModal, CustomerMergeModal } from '@/components/settings/customers/customer.actions.tsx';
import { useSecurity } from '@/hooks/useSecurity.ts';
import { useActionVisible } from '@/hooks/useActionVisible.ts';
import { getAccessRuleChildLabel } from '@/lib/access.rules.i18n.ts';
import { appPage } from '@/store/jotai.ts';
import {
  ACTIVE_CUSTOMER,
  CustomerIdDocumentTakenError,
  customerNumberLabel,
  isCustomerDeleted,
  parseCustomerNumber,
  restoreCustomer,
} from '@/lib/customer.service.ts';
import { maskIdDocument } from '@/lib/customer-id-document.ts';
import { displayPhone } from '@/lib/phone.ts';
import { phoneDigits } from '@/lib/guest.ts';
import { toLuxonDateTime } from '@/lib/datetime.ts';
import { cn } from '@/lib/utils.ts';

type Scope = 'active' | 'deleted';

const SCOPE_FILTERS: Record<Scope, string> = {
  active: ACTIVE_CUSTOMER,
  deleted: '(deleted_at != NONE OR merged_into != NONE)',
};

const SEARCH_FILTER = `(
  string::contains(string::lowercase(name ?? ''), $term)
  OR string::contains(string::lowercase(guest_code ?? ''), $term)
  OR string::contains(string::lowercase(email ?? ''), $term)
  OR string::contains(string::lowercase(type::string(room ?? '')), $term)
  OR ($digits != '' AND string::contains(phone_e164 ?? '', $digits))
  OR ($idDocument != '' AND string::contains(id_document_number ?? '', $idDocument))
  OR ($number != NONE AND number = $number)
)`;

/** Manage > Clients: the customer file. Nothing is deleted for good: removed clients can be restored. */
export const AdminCustomers = () => {
  const { t } = useTranslation(['admin', 'menu', 'common']);
  const db = useDB();
  const [page] = useAtom(appPage);
  const { protectAction } = useSecurity();
  const isVisible = useActionVisible();
  const canUpdate = isVisible('admin.customers.update');
  const canDelete = isVisible('admin.customers.delete');
  const canMerge = isVisible('admin.customers.merge');
  const canEditPreferences = isVisible('customers.preferences') || canUpdate;
  const canViewIdDocument = isVisible('customers.view_id_document');
  const canCreate = isVisible('customers.create') || canUpdate;

  const [scope, setScope] = useState<Scope>('active');
  const [searchTerm, setSearchTerm] = useState('');
  const loadHook = useApi<SettingsData<Customer>>(Tables.customers, [SCOPE_FILTERS.active], ['number DESC']);

  const [detail, setDetail] = useState<Customer>();
  const [editing, setEditing] = useState<Customer>();
  const [preferences, setPreferences] = useState<Customer>();
  const [deleting, setDeleting] = useState<Customer>();
  const [merging, setMerging] = useState<Customer>();
  const [creating, setCreating] = useState(false);

  const applyFilters = (nextScope: Scope, term: string) => {
    const text = term.trim().toLowerCase();
    const filters = [SCOPE_FILTERS[nextScope]];
    if (text) filters.push(SEARCH_FILTER);
    loadHook.handleFilterChange(filters);
    const digits = /\p{L}/u.test(text) ? '' : phoneDigits(text);
    loadHook.handleParameterChange({
      term: text,
      digits: digits.length >= 3 ? digits : '',
      idDocument: text.length >= 3 ? text.toUpperCase().replace(/[^A-Z0-9]/g, '') : '',
      number: parseCustomerNumber(text) ?? undefined,
    });
  };

  const guarded = (module: string, action: () => void) =>
    protectAction(action, { module, description: getAccessRuleChildLabel(module) });

  const restore = async (customer: Customer) => {
    try {
      await restoreCustomer(db, customer.id, page?.user);
      toast.success(t('admin:customers.restored', { name: customer.name }));
      loadHook.fetchData();
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof CustomerIdDocumentTakenError
          ? t('admin:customers.restoreIdTaken')
          : t('admin:customers.restoreFailed'),
      );
    }
  };

  const columnHelper = createColumnHelper<Customer>();
  const columns: any = [
    columnHelper.accessor('number', {
      header: t('menu:customer.number'),
      cell: (info) => <span className="whitespace-nowrap text-neutral-600">{customerNumberLabel(info.row.original)}</span>,
    }),
    columnHelper.accessor('name', {
      header: t('columns.name'),
      cell: (info) => {
        const customer = info.row.original;
        return (
          <span className="font-semibold">
            {customer.name || customer.guest_code}
            {customer.vip ? <FontAwesomeIcon icon={faCrown} className="ml-2 text-warning-500" title={t('menu:customer.vip')} /> : null}
            {customer.allergies?.length ? (
              <FontAwesomeIcon
                icon={faTriangleExclamation}
                className="ml-2 text-danger-600"
                title={customer.allergies.join(', ')}
              />
            ) : null}
          </span>
        );
      },
    }),
    columnHelper.accessor('phone', {
      header: t('menu:guest.phone'),
      enableSorting: false,
      cell: (info) => <span className="whitespace-nowrap">{displayPhone(info.getValue())}</span>,
    }),
    columnHelper.accessor('id_document_number', {
      header: t('menu:guest.idDocument'),
      enableSorting: false,
      cell: (info) => {
        const value = info.getValue();
        if (!value) return null;
        return canViewIdDocument ? value : maskIdDocument(value);
      },
    }),
    columnHelper.accessor('source', {
      header: t('admin:customers.source'),
      cell: (info) => t(`admin:customers.sources.${info.getValue() || 'local'}`, { defaultValue: info.getValue() || '' }),
    }),
    columnHelper.accessor(scope === 'deleted' ? 'deleted_at' : 'created_at', {
      id: scope === 'deleted' ? 'deleted_at' : 'created_at',
      header: scope === 'deleted' ? t('admin:customers.deletedAt') : t('admin:customers.createdAt'),
      cell: (info) => {
        const value = info.getValue() as string | Date | null | undefined;
        return value ? toLuxonDateTime(value).toFormat('dd LLL yyyy') : '';
      },
    }),
    columnHelper.accessor('id', {
      id: 'actions',
      header: t('columns.actions'),
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => {
        const customer = info.row.original;
        const deleted = isCustomerDeleted(customer);
        return (
          <div className="flex gap-2 items-center">
            <IconTooltipButton label={t('admin:customers.view')} variant="secondary" onClick={() => setDetail(customer)}>
              <FontAwesomeIcon icon={faEye} />
            </IconTooltipButton>
            {!deleted && canUpdate && (
              <IconTooltipButton
                label={t('common:actions.edit')}
                variant="primary"
                onClick={() => guarded('admin.customers.update', () => setEditing(customer))}
              >
                <FontAwesomeIcon icon={faPencil} />
              </IconTooltipButton>
            )}
            {!deleted && canEditPreferences && (
              <IconTooltipButton label={t('menu:customer.preferences')} variant="primary" onClick={() => setPreferences(customer)}>
                <FontAwesomeIcon icon={faSliders} />
              </IconTooltipButton>
            )}
            {!deleted && canMerge && (
              <IconTooltipButton
                label={t('admin:customers.merge')}
                variant="warning"
                onClick={() => guarded('admin.customers.merge', () => setMerging(customer))}
              >
                <FontAwesomeIcon icon={faCodeMerge} />
              </IconTooltipButton>
            )}
            {!deleted && canDelete && (
              <IconTooltipButton
                label={t('common:actions.delete')}
                variant="danger"
                onClick={() => guarded('admin.customers.delete', () => setDeleting(customer))}
              >
                <FontAwesomeIcon icon={faTrash} />
              </IconTooltipButton>
            )}
            {deleted && canDelete && (
              <IconTooltipButton
                label={t('admin:customers.restore')}
                variant="success"
                onClick={() => guarded('admin.customers.delete', () => void restore(customer))}
              >
                <FontAwesomeIcon icon={faRotateLeft} />
              </IconTooltipButton>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <>
      <TableComponent
        columns={columns}
        loaderHook={loadHook}
        loaderLineItems={columns.length}
        customSearch
        customSearchHandler={(value) => {
          setSearchTerm(value ?? '');
          applyFilters(scope, value ?? '');
        }}
        buttons={[
          canCreate ? (
            <Button
              key="add"
              variant="primary"
              icon={faPlus}
              onClick={() => setCreating(true)}
              data-testid="customers-add"
            >
              {t('common:actions.add')}
            </Button>
          ) : null,
          <div key="scope" className="input-group" data-testid="customers-scope">
            {(['active', 'deleted'] as Scope[]).map((item) => (
              <Button
                key={item}
                variant="primary"
                flat
                active={scope === item}
                className={cn(item === 'active' ? '!rounded-r-none' : '!rounded-l-none')}
                onClick={() => {
                  setScope(item);
                  applyFilters(item, searchTerm);
                }}
                data-testid={`customers-scope-${item}`}
              >
                {t(`admin:customers.scope.${item}`)}
              </Button>
            ))}
          </div>,
        ].filter(Boolean)}
      />

      <QuickCreateCustomerModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={() => loadHook.fetchData()}
      />
      <CustomerDetail customer={detail} canViewIdDocument={canViewIdDocument} onClose={() => setDetail(undefined)} />
      <CustomerForm
        customer={editing}
        canViewIdDocument={canViewIdDocument}
        onClose={() => setEditing(undefined)}
        onSaved={() => loadHook.fetchData()}
      />
      {preferences && (
        <CustomerPreferencesForm
          open
          customer={preferences}
          onClose={() => setPreferences(undefined)}
          onSaved={() => loadHook.fetchData()}
        />
      )}
      <CustomerDeleteModal customer={deleting} onClose={() => setDeleting(undefined)} onDone={() => loadHook.fetchData()} />
      <CustomerMergeModal customer={merging} onClose={() => setMerging(undefined)} onDone={() => loadHook.fetchData()} />
    </>
  );
};
