import { useTranslation } from 'react-i18next';
import {REPORTS_SALES_ADVANCED} from "@/routes/posr.ts";
import {DateRange} from "@/components/reports/filters/date.range.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import {Checkbox} from "@/components/common/input/checkbox.tsx";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Tables} from "@/api/db/tables.ts";
import {User} from "@/api/model/user.ts";
import {OrderType} from "@/api/model/order_type.ts";
import {Floor} from "@/api/model/floor.ts";
import {Table} from "@/api/model/table.ts";
import {Discount} from "@/api/model/discount.ts";
import {PaymentType} from "@/api/model/payment_type.ts";
import {Dish} from "@/api/model/dish.ts";
import {Menu} from "@/api/model/menu.ts";
import {formatTableLabel} from "@/lib/table-label.ts";

const toOption = <T extends { id?: any }>(
  item: T | undefined,
  label: string
) => {
  if (!item?.id) {
    return null;
  }

  const value =
    typeof item.id === "string" ? item.id : item.id.toString?.() ?? String(item.id);

  return {
    label,
    value,
  };
};

const notNull = <T,>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

export const SalesAdvancedFilter = () => {
  const { t } = useTranslation('reports');
  const {data: usersData, isLoading: loadingUsers} = useApi<SettingsData<User>>(Tables.users, [], ['first_name asc'], 0, 9999);
  const {data: orderTypesData, isLoading: loadingOrderTypes} = useApi<SettingsData<OrderType>>(Tables.order_types, [], ['name asc'], 0, 9999);
  const {data: floorsData, isLoading: loadingFloors} = useApi<SettingsData<Floor>>(Tables.floors, [], ['name asc'], 0, 9999);
  const {data: tablesData, isLoading: loadingTables} = useApi<SettingsData<Table>>(Tables.tables, [], ['name asc'], 0, 9999, ['floor']);
  const {data: discountsData, isLoading: loadingDiscounts} = useApi<SettingsData<Discount>>(Tables.discounts, [], ['name asc'], 0, 9999);
  const {data: paymentTypesData, isLoading: loadingPaymentTypes} = useApi<SettingsData<PaymentType>>(Tables.payment_types, [], ['name asc'], 0, 9999);
  const {data: menusData, isLoading: loadingMenus} = useApi<SettingsData<Menu>>(Tables.menus, ['deleted_at = none'], ['name asc'], 0, 9999);
  const {data: menuItemsData, isLoading: loadingMenuItems} = useApi<SettingsData<Dish>>(Tables.dishes, [], ['name asc'], 0, 9999);

  return (
    <form
      action={REPORTS_SALES_ADVANCED}
      className="flex flex-col gap-4 items-start w-full"
      target="_blank"
    >
      <DateRange isRequired />

      <div className="w-full flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-order-takers">{t('filters.orderTakers')}</label>
          <ReactSelect
            id="sales-advanced-order-takers"
            name="order_takers[]"
            isMulti
            isLoading={loadingUsers}
            className="w-full"
            options={(usersData?.data || [])
              .map(user =>
                toOption(user, `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.login || 'Unnamed user')
              )
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-cashiers">{t('metrics.cashiers')}</label>
          <ReactSelect
            id="sales-advanced-cashiers"
            name="cashiers[]"
            isMulti
            isLoading={loadingUsers}
            className="w-full"
            options={(usersData?.data || [])
              .map(user =>
                toOption(user, `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() || user.login || 'Unnamed user')
              )
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-tables">Tables</label>
          <ReactSelect
            id="sales-advanced-tables"
            name="tables[]"
            isMulti
            isLoading={loadingTables}
            className="w-full"
            options={(tablesData?.data || [])
              .map(table => toOption(table, table.name || table.source === 'asi-room' ? formatTableLabel(table) : `Table ${table.number ?? ''}`))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-floors">{t('metrics.floors')}</label>
          <ReactSelect
            id="sales-advanced-floors"
            name="floors[]"
            isMulti
            isLoading={loadingFloors}
            className="w-full"
            options={(floorsData?.data || [])
              .map(floor => toOption(floor, floor.name))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-order-types">{t('filters.orderTypes')}</label>
          <ReactSelect
            id="sales-advanced-order-types"
            name="order_types[]"
            isMulti
            isLoading={loadingOrderTypes}
            className="w-full"
            options={(orderTypesData?.data || [])
              .map(orderType => toOption(orderType, orderType.name))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label>{t('filters.taxFilter')}</label>
          <div className="flex flex-col gap-3">
            <Checkbox name="with_tax" value="1" label={t('filters.withTax')} />
            <Checkbox name="without_tax" value="1" label={t('filters.withoutTax')} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-discounts">{t('filters.discountFilter')}</label>
          <div className="flex flex-col gap-3 mb-2">
            <Checkbox name="with_discount" value="1" label={t('filters.withDiscount')} />
            <Checkbox name="without_discount" value="1" label={t('filters.withoutDiscount')} />
          </div>
          <ReactSelect
            id="sales-advanced-discounts"
            name="discounts[]"
            isMulti
            isLoading={loadingDiscounts}
            className="w-full"
            placeholder={t('filters.selectDiscountsOptional')}
            options={(discountsData?.data || [])
              .map(discount => toOption(discount, discount.name))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-payment-types">{t('filters.paymentTypes')}</label>
          <ReactSelect
            id="sales-advanced-payment-types"
            name="payment_types[]"
            isMulti
            isLoading={loadingPaymentTypes}
            className="w-full"
            options={(paymentTypesData?.data || [])
              .map(paymentType => toOption(paymentType, paymentType.name))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-menus">{t('filters.menus')}</label>
          <ReactSelect
            id="sales-advanced-menus"
            name="menus[]"
            isMulti
            isLoading={loadingMenus}
            className="w-full"
            options={(menusData?.data || [])
              .map(menu => toOption(menu, menu.name))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-menu-items">{t('filters.menuItems')}</label>
          <ReactSelect
            id="sales-advanced-menu-items"
            name="menu_items[]"
            isMulti
            isLoading={loadingMenuItems}
            className="w-full"
            options={(menuItemsData?.data || [])
              .map(item => toOption(item, item.name))
              .filter(notNull)}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="sales-advanced-menu-items-match">Menu Items Match</label>
          <select
            id="sales-advanced-menu-items-match"
            name="menu_items_match"
            className="form-control"
            defaultValue="any"
          >
            <option value="any">Any selected item</option>
            <option value="all">All selected items</option>
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label>Status Filters</label>
          <div className="flex flex-col gap-3">
            <Checkbox name="refund" value="1" label="Refund" />
            <Checkbox name="merged" value="1" label="Merged" />
            <Checkbox name="cancelled" value="1" label="Cancelled" />
            <Checkbox name="split" value="1" label="Split" />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label>{t('labels.displayOptions')}</label>
          <div className="flex flex-col gap-3">
            <Checkbox name="show_menu_items" value="1" label="Show Menu Items for Details" />
            <Checkbox name="show_details" value="1" label="Show Details" />
          </div>
        </div>

        <div className="flex flex-row gap-3">
          <div className="flex flex-col flex-1">
            <label htmlFor="sales-advanced-sort-by">{t('filters.sortBy')}</label>
            <select
              id="sales-advanced-sort-by"
              name="sortBy"
              className="form-control"
              defaultValue=""
            >
              <option value="">{t('labels.default')}</option>
              {['Invoice', 'Date', 'Status', 'Cashier', 'Order taker', 'Total'].map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col flex-1">
            <label htmlFor="sales-advanced-sort-direction">{t('filters.sortDirection')}</label>
            <select
              id="sales-advanced-sort-direction"
              name="sortDirection"
              className="form-control"
              defaultValue="Ascending"
            >
              {['Ascending', 'Descending'].map(item => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <Button
        variant="primary"
        filled
        type="submit"
      >{t('filters.generate')}</Button>
    </form>
  );
}