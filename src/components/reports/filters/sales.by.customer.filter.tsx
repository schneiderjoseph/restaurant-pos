import { useTranslation } from 'react-i18next';
import { REPORTS_SALES_BY_CUSTOMER } from '@/routes/posr.ts';
import { DateRange } from '@/components/reports/filters/date.range.tsx';
import { Button } from '@/components/common/input/button.tsx';
import { ReactSelect } from '@/components/common/input/custom.react.select.tsx';
import useApi, { SettingsData } from '@/api/db/use.api.ts';
import { Tables } from '@/api/db/tables.ts';
import type { Customer } from '@/api/model/customer.ts';
import type { PaymentType } from '@/api/model/payment_type.ts';
import { ACTIVE_CUSTOMER } from '@/lib/customer-scope.ts';

const toOption = <T extends { id?: unknown }>(item: T | undefined, label: string) => {
  if (!item?.id) return null;
  const value = typeof item.id === 'string' ? item.id : String(item.id);
  return { label, value };
};

export const SalesByCustomerFilter = () => {
  const { t } = useTranslation('reports');
  const { data: customersData, isLoading: loadingCustomers } = useApi<SettingsData<Customer>>(
    Tables.customers,
    [ACTIVE_CUSTOMER],
    ['name asc'],
    0,
    9999,
  );
  const { data: paymentTypesData, isLoading: loadingPaymentTypes } = useApi<SettingsData<PaymentType>>(
    Tables.payment_types,
    [],
    ['name asc'],
    0,
    9999,
  );

  const customerOptions = (customersData?.data || [])
    .map((customer) => {
      const number = customer.number ? ` (${customer.number})` : '';
      return toOption(customer, `${customer.name ?? ''}${number}`.trim() || String(customer.id));
    })
    .filter((option): option is { label: string; value: string } => option != null);

  const paymentOptions = (paymentTypesData?.data || [])
    .map((paymentType) => toOption(paymentType, paymentType.name || String(paymentType.id)))
    .filter((option): option is { label: string; value: string } => option != null);

  return (
    <form
      action={REPORTS_SALES_BY_CUSTOMER}
      className="flex flex-col gap-3 items-start"
      target="_blank"
    >
      <DateRange isRequired />

      <div className="flex flex-col gap-1 w-full max-w-md">
        <label htmlFor="sales-by-customer-customer">{t('filters.customerOptional')}</label>
        <ReactSelect
          inputId="sales-by-customer-customer"
          name="customer_id"
          isClearable
          isLoading={loadingCustomers}
          options={customerOptions}
          placeholder={t('filters.allCustomers')}
        />
      </div>

      <div className="flex flex-col gap-1 w-full max-w-md">
        <label htmlFor="sales-by-customer-payment-types">{t('filters.paymentTypes')}</label>
        <ReactSelect
          inputId="sales-by-customer-payment-types"
          name="payment_types[]"
          isMulti
          isClearable
          isLoading={loadingPaymentTypes}
          options={paymentOptions}
        />
      </div>

      <Button variant="primary" filled type="submit">
        {t('filters.generate')}
      </Button>
    </form>
  );
};
