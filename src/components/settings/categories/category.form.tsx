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
import { KITCHEN_FETCHES } from "@/api/model/kitchen.ts";

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
});

export const CategoryForm = ({
  open, onClose, data
}: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);

  const closeModal = () => {
    onClose();
    reset({
      name: null,
      priority: null,
      show_in_menu: null,
      outlet: null,
    });
  }

  useEffect(() => {
    if(data){
      const outletId = recordIdToString(data.outlet);
      reset({
        ...data,
        name: data.name,
        priority: data.priority.toString(),
        show_in_menu: data.show_in_menu,
        outlet: outletId
          ? { label: (data.outlet as Outlet)?.name ?? outletId, value: outletId }
          : { label: t('forms.outletNone'), value: '' },
      });
    }
  }, [data]);

  const db = useDB();

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

  const { control, handleSubmit, formState: {errors}, reset, setValue } = useForm({
    resolver: yupResolver(validationSchema)
  });

  const selectedOutlet = useWatch({ control, name: 'outlet' });

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
                  <Switch checked={field.value} onChange={field.onChange}>
                    Show this category in menu
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
          <div>
            <Button type="submit" variant="primary">{t('common:actions.save')}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
