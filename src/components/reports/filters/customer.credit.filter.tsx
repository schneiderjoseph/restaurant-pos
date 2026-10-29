import { useTranslation } from 'react-i18next';
import { REPORTS_CUSTOMER_CREDIT } from '@/routes/posr.ts';
import { Button } from '@/components/common/input/button.tsx';
import { ReactSelect } from '@/components/common/input/custom.react.select.tsx';
import { Checkbox } from '@/components/common/input/checkbox.tsx';
import useApi, { SettingsData } from '@/api/db/use.api.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';

const toOption = (customer: Customer) => {
  if (!customer?.id) return null;
  const value = typeof customer.id === 'string' ? customer.id : String(customer.id);
  const number = customer.number ? ` (${customer.number})` : '';
  return {
    label: `${customer.name ?? value}${number}`,
    value,
  };
};

/** Snapshot AR filter: optional customer (all if empty) + include zero-due rows. */
export const CustomerCreditFilter = () => {
  const { t } = useTranslation('reports');
  const { data: customersData, isLoading } = useApi<SettingsData<Customer>>(
    Tables.customers,
    [ACTIVE_CUSTOMER],
    ['name asc'],
    0,
    9999,
  );

  const options = (customersData?.data || [])
    .map(toOption)
    .filter((option): option is { label: string; value: string } => option != null);

  return (
    <form
      action={REPORTS_CUSTOMER_CREDIT}
      className="flex flex-col gap-3 items-start"
      target="_blank"
    >
      <div className="flex flex-col gap-1 w-full max-w-md">
        <label htmlFor="customer-credit-customer">{t('filters.customerOptional')}</label>
        <ReactSelect
          inputId="customer-credit-customer"
          name="customer_id"
          isClearable
          isLoading={isLoading}
          options={options}
          placeholder={t('filters.allCustomers')}
        />
      </div>
      <Checkbox
        id="customer-credit-include-settled"
        name="include_settled"
        value="1"
        label={t('filters.includeSettledCredit')}
      />
      <Button variant="primary" filled type="submit">
        {t('filters.generate')}
      </Button>
    </form>
  );
};
