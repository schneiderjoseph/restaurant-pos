import { Modal } from "@/components/common/react-aria/modal.tsx";
import { Input } from "@/components/common/input/input.tsx";
import { InputField } from "@/components/common/form/rhf-fields.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import { Category } from "@/api/model/category.ts";
import { Outlet } from "@/api/model/outlet.ts";
import { Dish } from "@/api/model/dish.ts";
import { Kitchen } from "@/api/model/kitchen.ts";
import { toast } from 'sonner';
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect, useMemo } from "react";
import {useTranslation} from 'react-i18next';
import i18n from '@/lib/i18n.ts';
import {Switch} from "@/components/common/input/switch.tsx";
import { ReactSelect } from "@/components/common/input/custom.react.select.tsx";
import useApi, { SettingsData } from "@/api/db/use.api.ts";
import { toRecordId } from "@/lib/utils.ts";
import { recordIdToString } from "@/api/reports/shared/records.ts";
import { suggestOutlet } from "@/lib/outlet.ts";
import { isCategoryShownInMenu } from "@/lib/menu-categories.ts";
import { KITCHEN_FETCHES } from "@/api/model/kitchen.ts";
import { TimePicker } from "@/components/common/antd/time.picker.tsx";
import { hasCategoryHours } from "@/lib/category-hours.ts";

import { emitEntityCrudSave } from '@/integrations/events/entity-write.ts';

interface Props {
  open: boolean
  onClose: () => void;
  data?: Category
}

const selectOptionSchema = yup.object({
  label: yup.string(),
  value: yup.string()
}).nullable();

const validationSchema = yup.object({
  name: yup.string().required(i18n.t('validation:required')),
  priority: yup.string().required(i18n.t('validation:required')).typeError(i18n.t('validation:mustBeNumber')),
  show_in_menu: yup.boolean(),
  outlet: selectOptionSchema.optional(),
  available_from: yup.string().nullable(),
  available_to: yup.string().nullable(),
  room_included: yup.boolean(),
  walkin_price: yup.number()
    .transform((value, original) => (original === '' || original == null ? null : value))
    .nullable()
    .min(0, i18n.t('validation:mustBeNumber'))
    .typeError(i18n.t('validation:mustBeNumber')),
  package_base_items: yup.array().of(selectOptionSchema).nullable(),
});

type Option = { label: string; value: string };

const dishLabel = (dish?: Partial<Dish> | null): string =>
  [dish?.number, dish?.name].filter(Boolean).join(' · ');

/** Category hours fields, named only when set or being cleared like `outlet`: keeps the save
 * valid on a DB without migrations/2026_10_09_category_hours.surql (SCHEMAFULL). */
const HOURS_FIELDS = ['available_from', 'available_to', 'room_included', 'walkin_price', 'package_base_items'] as const;

export const CategoryForm = ({
  open, onClose, data
}: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);
  const db = useDB();

  const { control, handleSubmit, formState: {errors}, reset, setValue } = useForm({
    resolver: yupResolver(validationSchema),
    defaultValues: { show_in_menu: true },
  });

  const closeModal = () => {
    onClose();
    reset({
      name: null,
      priority: null,
      show_in_menu: true,
      outlet: null,
      available_from: null,
      available_to: null,
      room_included: false,
      walkin_price: null,
      package_base_items: [],
    });
  }

  useEffect(() => {
    if(data){
      const outletId = recordIdToString(data.outlet);
      reset({
        ...data,
        name: data.name,
        priority: String(data.priority ?? ''),
        show_in_menu: isCategoryShownInMenu(data),
        outlet: outletId
          ? { label: (data.outlet as Outlet)?.name ?? outletId, value: outletId }
          : { label: t('forms.outletNone'), value: '' },
        available_from: data.available_from ?? null,
        available_to: data.available_to ?? null,
        room_included: data.room_included === true,
        walkin_price: data.walkin_price ?? null,
        package_base_items: [],
      });
    }
  }, [data, reset, t]);

  const { data: outlets } = useApi<SettingsData<Outlet>>(
    Tables.outlets,
    ['deleted_at = none'],
    ['priority asc'],
    0,
    99999,
    [],
    { enabled: open },
  );

  const { data: allCategories } = useApi<SettingsData<Category>>(
    Tables.categories,
    ['deleted_at = none'],
    ['priority asc'],
    0,
    99999,
    ['outlet'],
    { enabled: open },
  );

  const { data: dishes } = useApi<SettingsData<Dish>>(
    Tables.dishes,
    ['deleted_at = none'],
    [],
    0,
    99999,
    ['categories'],
    { enabled: open },
  );

  const { data: kitchens } = useApi<SettingsData<Kitchen>>(
    Tables.kitchens,
    ['deleted_at = none'],
    ['priority asc'],
    0,
    99999,
    [...KITCHEN_FETCHES],
    { enabled: open },
  );

  const selectedOutlet = useWatch({ control, name: 'outlet' });
  const roomIncluded = useWatch({ control, name: 'room_included' });

  const categoryDishOptions = useMemo<Option[]>(() => {
    const categoryId = recordIdToString(data?.id);
    return (dishes?.data ?? [])
      .filter((dish) => (dish.categories ?? []).some((category) => recordIdToString(category) === categoryId))
      .map((dish) => ({ label: dishLabel(dish), value: recordIdToString(dish.id) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  }, [dishes?.data, data?.id]);

  // The base dish picker fills in once the dishes are loaded.
  useEffect(() => {
    if (!data || !dishes?.data) {
      return;
    }
    const byId = new Map(categoryDishOptions.map((option) => [option.value, option]));
    setValue('package_base_items', (data.package_base_items ?? []).map((item) => {
      const id = recordIdToString(item);
      return byId.get(id) ?? { label: id, value: id };
    }));
  }, [data, dishes?.data, categoryDishOptions, setValue]);

  const suggestion = useMemo(() => {
    if (!data?.id || recordIdToString(data.outlet) || recordIdToString(selectedOutlet?.value)) {
      return undefined;
    }
    return suggestOutlet(
      data.id,
      allCategories?.data ?? [],
      dishes?.data ?? [],
      kitchens?.data ?? [],
    );
  }, [data, selectedOutlet, allCategories?.data, dishes?.data, kitchens?.data]);

  const outletOptions = useMemo(() => [
    { label: t('forms.outletNone'), value: '' },
    ...(outlets?.data ?? []).map((item) => ({
      label: item.name,
      value: recordIdToString(item.id),
    })),
  ], [outlets?.data, t]);

  const onSubmit = async (values: any) => {
    const vals = {...values};
    vals.priority = parseInt(vals.priority);
    // Named only when set or being cleared: keeps the save valid on a DB without
    // migrations/2026_10_02_outlets.surql (SCHEMAFULL).
    if (values.outlet?.value) {
      vals.outlet = toRecordId(values.outlet.value);
    } else if (recordIdToString(data?.outlet)) {
      vals.outlet = null;
    } else {
      delete vals.outlet;
    }

    const hours = {
      available_from: values.available_from || null,
      available_to: values.available_to || null,
      room_included: values.room_included === true,
      walkin_price: values.room_included && values.walkin_price != null ? Number(values.walkin_price) : null,
      package_base_items: values.room_included
        ? (values.package_base_items ?? [])
          .filter((option: Option | null) => option?.value)
          .map((option: Option) => toRecordId(option.value))
        : [],
    };
    const hadHours = hasCategoryHours(data) || data?.room_included === true || data?.walkin_price != null;
    for (const field of HOURS_FIELDS) {
      delete vals[field];
    }
    if (hadHours || hours.available_from || hours.available_to || hours.room_included) {
      Object.assign(vals, hours);
    }

    try {
      if(data?.id){
        await db.update(data.id, {
          ...vals
        })
      }else{
        await db.create(Tables.categories, {
          ...vals
        });
      }

      
      await emitEntityCrudSave({
        domain: 'manage',
        table: Tables.categories,
        entityId: data?.id ? String(data.id) : Tables.categories,
        isUpdate: Boolean(data?.id),
        source: 'settings-form',
      });

      closeModal();
      toast.success(t('toast:admin.categorySaved', { name: values.name }));
    }catch(e){
      toast.error(e);
      console.log(e)
    }
  }

  return (
    <>
      <Modal
        testId="admin-form-category"
        title={data ? t('forms.updateCategory', { name: data?.name }) : t('forms.createCategory')}
        open={open}
        onClose={closeModal}
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <InputField name="name" control={control} label={t('forms.nameOfCategory')} autoFocus error={errors?.name?.message} />
            </div>
            <div className="flex-1">
              <Controller
                render={({field}) => (
                  <Input
                    type="number"
                    label={t('columns.priority')}
                    error={errors?.priority?.message}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
                name="priority"
                control={control}
              />
            </div>
          </div>
          <div className="mb-3">
            <div className="flex-1">
              <Controller
                name={`show_in_menu`}
                control={control}
                render={({ field }) => (
                  <Switch checked={field.value !== false} onChange={field.onChange}>
                    {t('forms.showCategoryInMenu')}
                  </Switch>
                )}
              />
            </div>
          </div>
          <div className="mb-3">
            <label htmlFor="">{t('forms.outlet')}</label>
            <Controller
              name="outlet"
              control={control}
              render={({ field }) => (
                <ReactSelect
                  value={field.value}
                  onChange={field.onChange}
                  options={outletOptions}
                  placeholder={t('forms.outletNone')}
                />
              )}
            />
            {suggestion && (
              <div className="mt-2 flex items-center gap-2 text-sm text-neutral-600">
                <span>{t('forms.outletSuggested', { name: suggestion.name })}</span>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setValue('outlet', {
                      label: suggestion.name,
                      value: recordIdToString(suggestion.id),
                    });
                  }}
                >
                  {t('forms.applySuggestion')}
                </Button>
              </div>
            )}
          </div>
          <fieldset className="mb-3 rounded-lg border border-neutral-200 p-3">
            <legend className="px-1 text-sm font-semibold">{t('forms.categoryHours.title')}</legend>
            <p className="mb-2 text-sm text-neutral-600">{t('forms.categoryHours.help')}</p>
            <div className="flex gap-3 mb-3">
              <div className="flex-1">
                <Controller
                  name="available_from"
                  control={control}
                  render={({ field }) => (
                    <TimePicker label={t('forms.categoryHours.from')} value={field.value} onChange={field.onChange} isClearable />
                  )}
                />
              </div>
              <div className="flex-1">
                <Controller
                  name="available_to"
                  control={control}
                  render={({ field }) => (
                    <TimePicker label={t('forms.categoryHours.to')} value={field.value} onChange={field.onChange} isClearable />
                  )}
                />
              </div>
            </div>
            <div className="mb-3">
              <Controller
                name="room_included"
                control={control}
                render={({ field }) => (
                  <Switch checked={field.value === true} onChange={field.onChange}>
                    {t('forms.categoryHours.roomIncluded')}
                  </Switch>
                )}
              />
            </div>
            {roomIncluded && (
              <>
                <div className="mb-3">
                  <Controller
                    name="walkin_price"
                    control={control}
                    render={({ field }) => (
                      <Input
                        type="number"
                        label={t('forms.categoryHours.walkinPrice')}
                        error={errors?.walkin_price?.message}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                      />
                    )}
                  />
                  <p className="mt-1 text-xs text-neutral-500">{t('forms.categoryHours.walkinPriceHelp')}</p>
                </div>
                <div className="mb-3">
                  <label htmlFor="">{t('forms.categoryHours.baseItems')}</label>
                  <Controller
                    name="package_base_items"
                    control={control}
                    render={({ field }) => (
                      <ReactSelect
                        isMulti
                        value={field.value ?? []}
                        onChange={field.onChange}
                        options={categoryDishOptions}
                        isSearchable
                        placeholder={t('forms.categoryHours.baseItemsNone')}
                      />
                    )}
                  />
                  <p className="mt-1 text-xs text-neutral-500">{t('forms.categoryHours.baseItemsHelp')}</p>
                </div>
              </>
            )}
          </fieldset>
          <div>
            <Button type="submit" variant="primary">{t('common:actions.save')}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
