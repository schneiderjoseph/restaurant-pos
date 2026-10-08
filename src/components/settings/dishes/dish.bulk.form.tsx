import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Input, InputError} from "@/components/common/input/input.tsx";
import {Button} from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {Controller, useFieldArray, useForm, useWatch} from "react-hook-form";
import {useDB} from "@/api/db/db.ts";
import {toast} from "sonner";
import {useTranslation} from 'react-i18next';
import i18n from '@/lib/i18n.ts';
import * as yup from "yup";
import {yupResolver} from "@hookform/resolvers/yup";
import {Dish} from "@/api/model/dish.ts";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {Category} from "@/api/model/category.ts";
import {Tables} from "@/api/db/tables.ts";
import {ModifierGroup} from "@/api/model/modifier_group.ts";
import {Workflow} from "@/api/model/workflow.ts";
import {Switch} from "@/components/common/input/switch.tsx";
import get from "lodash/get";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faPlus, faTrash} from "@fortawesome/free-solid-svg-icons";
import {CategoryForm} from "@/components/settings/categories/category.form.tsx";
import {ModifierGroupForm} from "@/components/settings/modifier_groups/modifier_group.form.tsx";
import {WorkflowForm} from "@/components/settings/workflows/workflow.form.tsx";
import {StringRecordId, type RecordId} from "surrealdb";
import React, {useEffect, useState} from "react";
import {formatFileSize, MAX_UPLOAD_BYTES} from "@/utils/files";
import {
  includedModifiersRelateSet,
  isMaxModifiersValid,
  optionalCountSchema,
} from "@/components/settings/dishes/included-modifiers.ts";

interface Props {
  open: boolean
  onClose: () => void;
  data: Dish[]
}

const numberField = yup
  .number()
  .transform((value, originalValue) => (originalValue === "" || originalValue === null ? undefined : value))
  .typeError(i18n.t('validation:mustBeNumber'));

const validationSchema = yup.object({
  price: numberField.min(0, i18n.t('forms.greaterThanOrEqualZero')).optional(),
  replace_workflow: yup.boolean().default(false),
  workflow: yup.object({
    label: yup.string(),
    value: yup.string()
  }).nullable().default(null),
  replace_categories: yup.boolean().default(false),
  categories: yup.array(yup.object({
    label: yup.string().required(),
    value: yup.string().required()
  })).default([]).when('replace_categories', {
    is: true,
    then: (schema) => schema.min(1, i18n.t('validation:required')),
  }),
  replace_modifier_groups: yup.boolean().default(false),
  modifier_groups: yup.array(yup.object({
    modifier_group: yup.object({
      label: yup.string(),
      value: yup.string()
    }).required(i18n.t('validation:required')),
    has_required_modifiers: yup.boolean(),
    required_modifiers: yup.number().when("has_required_modifiers", (hasRequiredModifiers, schema) => {
      if (hasRequiredModifiers[0]) {
        return schema.min(1, i18n.t('validation:mustBeGreaterThanZero')).required(i18n.t('validation:required'));
      }

      return schema;
    }),
    should_auto_open: yup.boolean(),
    should_auto_select: yup.boolean(),
    included_modifiers: optionalCountSchema(),
    max_modifiers: optionalCountSchema().test(
      'max-covers-included',
      i18n.t('admin:forms.maxModifiersTooLow'),
      function (max) {
        return isMaxModifiersValid(this.parent, max);
      }
    ),
    priority: yup.number().required(i18n.t('validation:required')),
  })).default([]),
});

const DISH_BULK_DEFAULT_VALUES = {
  price: undefined,
  replace_workflow: false,
  workflow: null,
  replace_categories: false,
  categories: [],
  replace_modifier_groups: false,
  modifier_groups: [],
};

export const DishBulkForm = ({ open, onClose, data }: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);
  const defaultValues = DISH_BULK_DEFAULT_VALUES;
  const [categoriesModal, setCategoriesModal] = useState(false);
  const [modifierGroupsModal, setModifierGroupsModal] = useState(false);
  const [workflowModal, setWorkflowModal] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<ArrayBuffer | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const db = useDB();

  const closeModal = () => {
    setPhotoData(null);
    setPhotoPreview(null);
    setPhotoFile(null);
    reset(defaultValues);
    onClose();
  };

  const {control, handleSubmit, formState: {errors}, reset, watch} = useForm({
    resolver: yupResolver(validationSchema),
  });

  const {
    data: categories,
    fetchData: fetchCategories,
    isFetching: loadingCategories
  } = useApi<SettingsData<Category>>(Tables.categories, [], [], 0, 99999, [], {
    enabled: false
  });

  const {
    data: modifierGroups,
    fetchData: fetchModifierGroups,
    isFetching: loadingModifierGroups
  } = useApi<SettingsData<ModifierGroup>>(Tables.modifier_groups, [], [], 0, 99999, ["modifiers", "modifiers.modifier"], {
    enabled: false
  });

  const {
    data: workflows,
    fetchData: fetchWorkflows,
    isFetching: loadingWorkflows
  } = useApi<SettingsData<Workflow>>(Tables.workflows, ["deleted_at = none"], ["name asc"], 0, 99999, [], {
    enabled: false
  });

  useEffect(() => {
    if (open) {
      fetchCategories();
      fetchModifierGroups();
      fetchWorkflows();
      reset(defaultValues);
    }
  }, [open, fetchCategories, fetchModifierGroups, fetchWorkflows, reset, defaultValues]);

  const {
    fields: modifierGroupFields,
    append: appendModifierGroup,
    remove: removeModifierGroup
  } = useFieldArray({
    name: "modifier_groups",
    control
  });

  const replaceWorkflow = useWatch({control, name: "replace_workflow", defaultValue: false});
  const replaceCategories = useWatch({control, name: "replace_categories", defaultValue: false});
  const replaceModifierGroups = useWatch({control, name: "replace_modifier_groups", defaultValue: false});

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setPhotoFile(null);
      setPhotoData(null);
      setPhotoPreview(null);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        t('common:csvImport.fileTooLarge', { max: formatFileSize(MAX_UPLOAD_BYTES) })
      );
      setPhotoFile(null);
      setPhotoData(null);
      setPhotoPreview(null);
      event.target.value = '';
      return;
    }

    setPhotoFile(file);

    try {
      const buffer = await file.arrayBuffer();
      setPhotoData(buffer);
      const blob = new Blob([buffer], {type: file.type || "application/octet-stream"});
      setPhotoPreview(URL.createObjectURL(blob));
    } catch (error) {
      setPhotoFile(null);
      setPhotoData(null);
      setPhotoPreview(null);
      toast.error(t('toast:admin.failedReadPhoto'));
      console.log(error);
    }
  };

  const onSubmit = async (values: any) => {
    if (!data?.length) {
      toast.error(t('toast:admin.noDishesSelected'));
      return;
    }

    const payload: any = {};
    if (values.price !== undefined) {
      payload.price = parseFloat(String(values.price));
    }
    if (values.replace_categories) {
      payload.categories = values.categories.map((category) => new StringRecordId(category.value.toString()));
    }
    if (values.replace_workflow) {
      payload.workflow = values.workflow?.value ? new StringRecordId(values.workflow.value.toString()) : null;
      // Per-stage overrides are product/stage specific, so reset them on bulk assignment.
      payload.stage_overrides = null;
    }

    try {
      let photoDocumentId: string | undefined | RecordId;
      if (photoData && photoFile) {
        const [photo] = await db.create(Tables.documents, {
          name: photoFile.name,
          content: photoData,
          size: photoFile.size,
          type: photoFile.type || undefined,
        });
        photoDocumentId = photo.id;
      }

      for (const dish of data) {
        if (Object.keys(payload).length > 0) {
          await db.merge(dish.id, payload);
        }

        if (photoDocumentId) {
          await db.merge(dish.id, {dish_photo: photoDocumentId});
        }

        if (values.replace_modifier_groups) {
          await db.query(`DELETE ${dish.id}->${Tables.dish_modifier_groups} where in = ${dish.id}`);

          for (const modifierGroup of values.modifier_groups) {
            const included = includedModifiersRelateSet(modifierGroup);
            await db.query(
              `RELATE ${dish.id}->${Tables.dish_modifier_groups}->${modifierGroup.modifier_group.value}
               set has_required_modifiers = $has_required_modifiers,
               should_auto_open = $should_auto_open,
               required_modifiers = $required_modifiers,
               should_auto_select = $should_auto_select,
               priority = $priority${included.sql}`,
              {
                has_required_modifiers: modifierGroup.has_required_modifiers,
                should_auto_open: modifierGroup.should_auto_open,
                required_modifiers: modifierGroup.required_modifiers,
                should_auto_select: modifierGroup.should_auto_select,
                priority: Number(modifierGroup.priority ?? 0),
                ...included.bindings,
              }
            );
          }
        }
      }

      toast.success(t('toast:admin.dishesBulkUpdated', { count: data.length }));
      closeModal();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('forms.failedUpdateDishes');
      toast.error(message);
      console.log(error);
    }
  };

  return (
    <>
      <Modal
        title={t('forms.bulkUpdateDishes', { count: data?.length || 0 })}
        open={open}
        onClose={closeModal}
        size="full"
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <Controller
                name="price"
                control={control}
                render={({field}) => (
                  <Input
                    value={field.value}
                    onChange={field.onChange}
                    type="number"
                    label={t('columns.salePrice')}
                    error={errors?.price?.message}
                  />
                )}
              />
            </div>
          </div>

          <div className="flex mb-3">
            <fieldset className="border-2 border-neutral-900 rounded-lg p-3 flex-1">
              <legend className="px-2">{t('forms.productionWorkflow')}</legend>
              <div className="mb-3">
                <Controller
                  name="replace_workflow"
                  control={control}
                  render={({field}) => (
                    <Switch checked={field.value} onChange={field.onChange}>
                      {t('forms.setWorkflowForSelected')}
                    </Switch>
                  )}
                />
              </div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  <label>{t('forms.workflowClearLegacyHint')}</label>
                  <Controller
                    name="workflow"
                    control={control}
                    render={({field}) => (
                      <ReactSelect
                        isClearable
                        value={field.value}
                        onChange={field.onChange}
                        isLoading={loadingWorkflows}
                        isDisabled={!replaceWorkflow}
                        options={workflows?.data?.map((item) => ({
                          label: item.name,
                          value: item.id.toString()
                        }))}
                      />
                    )}
                  />
                </div>
                <IconTooltipButton label={t('common:actions.add')}
                  type="button"
                  variant="primary"
                  disabled={!replaceWorkflow}
                  onClick={() => setWorkflowModal(true)}
                ><FontAwesomeIcon icon={faPlus}/></IconTooltipButton>
              </div>
            </fieldset>
          </div>

          <div className="mb-3">
            <Controller
              name="replace_categories"
              control={control}
              render={({field}) => (
                <Switch checked={field.value} onChange={field.onChange}>
                  {t('forms.replaceCategoriesForSelected')}
                </Switch>
              )}
            />
          </div>

          <div className="flex gap-3 mb-3 items-end">
            <div className="flex-1">
              <label>{t('columns.categories')}</label>
              <Controller
                name="categories"
                render={({field}) => (
                  <ReactSelect
                    options={categories?.data?.map((item) => ({
                      label: item.name,
                      value: item.id
                    }))}
                    isMulti
                    value={field.value}
                    onChange={field.onChange}
                    isLoading={loadingCategories}
                    isDisabled={!replaceCategories}
                  />
                )}
                control={control}
              />
              {errors?.categories?.message && <InputError error={errors?.categories?.message}/>}
            </div>
            <div className="flex-0">
              <IconTooltipButton label={t('common:actions.add')} onClick={() => setCategoriesModal(true)} type="button" variant="primary" disabled={!replaceCategories}><FontAwesomeIcon icon={faPlus}/></IconTooltipButton>
            </div>
          </div>

          <div className="flex gap-3 mb-3 items-end">
            <div className="flex-1">
              <label className="block mb-1">{t('forms.photo')}</label>
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                className="block w-full text-sm text-neutral-700
                           file:mr-4 file:py-2 file:px-4
                           file:rounded-full file:border-0
                           file:text-sm file:font-semibold
                           file:bg-neutral-600 file:text-white
                           hover:file:bg-neutral-700"
              />
            </div>
            {photoPreview && (
              <div className="w-24 h-24 rounded-lg overflow-hidden border border-neutral-300 flex items-center justify-center bg-neutral-100">
                <img
                  src={photoPreview}
                  alt={t('forms.dishPhotoPreview')}
                  className="object-cover w-full h-full"
                />
              </div>
            )}
          </div>

          <div className="flex mb-3">
            <fieldset className="border-2 border-neutral-900 rounded-lg p-3 flex-1">
              <legend className="px-2">{t('columns.modifierGroups')}</legend>
              <div className="mb-3">
                <Controller
                  name="replace_modifier_groups"
                  control={control}
                  render={({field}) => (
                    <Switch checked={field.value} onChange={field.onChange}>
                      {t('forms.replaceModifierGroupsForSelected')}
                    </Switch>
                  )}
                />
              </div>

              <div className="mb-3 flex gap-3">
                <Button
                  type="button"
                  icon={faPlus}
                  variant="primary"
                  onClick={() => appendModifierGroup({
                    modifier_group: null,
                    has_required_modifiers: false,
                    required_modifiers: 0,
                    should_auto_open: false,
                    should_auto_select: false,
                    priority: 0
                  })}
                  disabled={!replaceModifierGroups}
                >
                  {t('entities.modifierGroup')}
                </Button>

                <Button
                  type="button"
                  icon={faPlus}
                  variant="primary"
                  flat
                  onClick={() => setModifierGroupsModal(true)}
                  disabled={!replaceModifierGroups}
                >
                  {t('forms.createModifierGroup')}
                </Button>
              </div>

              {modifierGroupFields.map((item, index) => (
                <div className="flex gap-3 mb-3" key={item.id}>
                  <div className="flex-1">
                    <label>{t('entities.modifierGroup')}</label>
                    <Controller
                      name={`modifier_groups.${index}.modifier_group`}
                      control={control}
                      render={({field}) => (
                        <ReactSelect
                          value={field.value}
                          onChange={field.onChange}
                          isLoading={loadingModifierGroups}
                          options={modifierGroups?.data?.map((modifierGroup) => ({
                            label: modifierGroup.name,
                            value: modifierGroup.id,
                          }))}
                          isDisabled={!replaceModifierGroups}
                        />
                      )}
                    />
                    <InputError error={get(errors, ["modifier_groups", index, "modifier_group", "message"])}/>
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.should_auto_select`}
                      control={control}
                      render={({field}) => (
                        <Switch checked={field.value} onChange={field.onChange} disabled={!replaceModifierGroups}>
                          {t('forms.autoSelectModifiers')}
                        </Switch>
                      )}
                    />
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.should_auto_open`}
                      control={control}
                      render={({field}) => (
                        <Switch checked={field.value} onChange={field.onChange} disabled={!replaceModifierGroups}>
                          {t('forms.autoOpenModifiers')}
                        </Switch>
                      )}
                    />
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.has_required_modifiers`}
                      control={control}
                      render={({field}) => (
                        <Switch checked={field.value} onChange={field.onChange} disabled={!replaceModifierGroups}>
                          {t('columns.hasRequiredModifiers')}
                        </Switch>
                      )}
                    />
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.required_modifiers`}
                      control={control}
                      render={({field}) => (
                        <Input
                          type="number"
                          value={field.value}
                          onChange={field.onChange}
                          label={t('forms.requiredModifiers')}
                          disabled={!replaceModifierGroups || !watch(`modifier_groups.${index}.has_required_modifiers`)}
                          error={get(errors, ["modifier_groups", index, "required_modifiers", "message"])}
                        />
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <Controller
                      name={`modifier_groups.${index}.included_modifiers`}
                      control={control}
                      render={({field}) => (
                        <Input
                          type="number"
                          min={0}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          label={t('forms.includedModifiers')}
                          title={t('forms.includedModifiersHint')}
                          disabled={!replaceModifierGroups}
                          error={get(errors, ["modifier_groups", index, "included_modifiers", "message"])}
                        />
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <Controller
                      name={`modifier_groups.${index}.max_modifiers`}
                      control={control}
                      render={({field}) => (
                        <Input
                          type="number"
                          min={0}
                          value={field.value ?? ''}
                          onChange={field.onChange}
                          label={t('forms.maxModifiers')}
                          title={t('forms.maxModifiersHint')}
                          disabled={!replaceModifierGroups || !Number(watch(`modifier_groups.${index}.included_modifiers`))}
                          error={get(errors, ["modifier_groups", index, "max_modifiers", "message"])}
                        />
                      )}
                    />
                  </div>
                  <div className="flex-1">
                    <Controller
                      name={`modifier_groups.${index}.priority`}
                      control={control}
                      render={({field}) => (
                        <Input
                          type="number"
                          value={field.value}
                          onChange={field.onChange}
                          label={t('columns.priority')}
                          disabled={!replaceModifierGroups}
                          error={get(errors, ["modifier_groups", index, "priority", "message"])}
                        />
                      )}
                    />
                  </div>
                  <div className="flex-0 self-end">
                    <IconTooltipButton label={t('common:actions.remove')} variant="danger" onClick={() => removeModifierGroup(index)} disabled={!replaceModifierGroups}><FontAwesomeIcon icon={faTrash}/></IconTooltipButton>
                  </div>
                </div>
              ))}
            </fieldset>
          </div>

          <div>
            <Button type="submit" variant="primary">{t('common:actions.save')}</Button>
          </div>
        </form>
      </Modal>

      {categoriesModal && (
        <CategoryForm
          open={categoriesModal}
          onClose={() => {
            setCategoriesModal(false);
            fetchCategories();
          }}
        />
      )}

      {modifierGroupsModal && (
        <ModifierGroupForm
          open={modifierGroupsModal}
          onClose={() => {
            setModifierGroupsModal(false);
            fetchModifierGroups();
          }}
        />
      )}

      {workflowModal && (
        <WorkflowForm
          open={true}
          onClose={() => {
            fetchWorkflows();
            setWorkflowModal(false);
          }}
        />
      )}
    </>
  );
};
