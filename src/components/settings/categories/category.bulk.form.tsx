import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Button} from "@/components/common/input/button.tsx";
import {Controller, useForm} from "react-hook-form";
import {useDB} from "@/api/db/db.ts";
import {toast} from "sonner";
import {useTranslation} from 'react-i18next';
import * as yup from "yup";
import {yupResolver} from "@hookform/resolvers/yup";
import {Category} from "@/api/model/category.ts";
import {Outlet} from "@/api/model/outlet.ts";
import {Tables} from "@/api/db/tables.ts";
import {Switch} from "@/components/common/input/switch.tsx";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {useEffect, useMemo} from "react";
import {isCategoryShownInMenu} from "@/lib/menu-categories.ts";
import {recordIdToString} from "@/api/reports/shared/records.ts";
import {toRecordId} from "@/lib/utils.ts";

interface Props {
  open: boolean
  onClose: () => void;
  data: Category[]
}

/** Outlet select value meaning "leave each category's outlet as it is". */
const KEEP_OUTLET = '__keep__';

const validationSchema = yup.object({
  show_in_menu: yup.boolean(),
  outlet: yup.object({
    label: yup.string(),
    value: yup.string(),
  }).nullable(),
});

export const CategoryBulkForm = ({
  open, onClose, data
}: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);

  const db = useDB();

  const {data: outlets} = useApi<SettingsData<Outlet>>(
    Tables.outlets,
    ['deleted_at = none'],
    ['priority asc'],
    0,
    99999,
    [],
    {enabled: open},
  );

  const keepOption = useMemo(
    () => ({label: t('forms.outletKeep'), value: KEEP_OUTLET}),
    [t],
  );

  const outletOptions = useMemo(() => [
    keepOption,
    {label: t('forms.outletNone'), value: ''},
    ...(outlets?.data ?? []).map((item) => ({
      label: item.name,
      value: recordIdToString(item.id),
    })),
  ], [keepOption, outlets?.data, t]);

  const defaults = useMemo(() => ({
    // On unless every row is hidden, so saving untouched is a no-op.
    show_in_menu: !(data?.length && data.every((category) => !isCategoryShownInMenu(category))),
    outlet: keepOption,
  }), [data, keepOption]);

  const {control, handleSubmit, reset, formState: {dirtyFields}} = useForm({
    resolver: yupResolver(validationSchema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (open) {
      reset(defaults);
    }
  }, [open, defaults, reset]);

  const closeModal = () => {
    onClose();
    reset(defaults);
  };

  const onSubmit = async (values: any) => {
    if (!data?.length) {
      toast.error(t('toast:admin.noCategoriesSelected'));
      return;
    }

    // Only write what the user touched: one field changed must not reset the other.
    const patch: Record<string, unknown> = {};
    if (dirtyFields.show_in_menu) {
      patch.show_in_menu = values.show_in_menu;
    }
    const outletValue = values.outlet?.value ?? KEEP_OUTLET;
    if (outletValue !== KEEP_OUTLET) {
      patch.outlet = outletValue ? toRecordId(outletValue) : null;
    }
    if (Object.keys(patch).length === 0) {
      closeModal();
      return;
    }

    try {
      await Promise.all(
        data.map((category) => db.merge(category.id, patch))
      );

      toast.success(t('toast:admin.categoriesBulkUpdated', { count: data.length }));
      closeModal();
    } catch (error) {
      toast.error(error);
      console.log(error);
    }
  };

  return (
    <Modal
      title={t('forms.bulkUpdateCategories', { count: data?.length || 0 })}
      open={open}
      onClose={closeModal}
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="mb-3">
          <Controller
            name="show_in_menu"
            control={control}
            render={({field}) => (
              <Switch checked={field.value !== false} onChange={field.onChange}>
                {t('forms.showCategoryInMenu')}
              </Switch>
            )}
          />
        </div>
        <div className="mb-3">
          <label htmlFor="">{t('forms.outlet')}</label>
          <Controller
            name="outlet"
            control={control}
            render={({field}) => (
              <ReactSelect
                value={field.value}
                onChange={field.onChange}
                options={outletOptions}
              />
            )}
          />
        </div>
        <div>
          <Button type="submit" variant="primary">{t('common:actions.save')}</Button>
        </div>
      </form>
    </Modal>
  );
};
