import {Modal} from "@/components/common/react-aria/modal.tsx";
import {Dish} from "@/api/model/dish.ts";
import {Input, InputError} from "@/components/common/input/input.tsx";
import {InputField} from "@/components/common/form/rhf-fields.tsx";
import {Button} from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import {Controller, useFieldArray, useForm} from "react-hook-form";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";
import {useDB} from "@/api/db/db.ts";
import React, { useCallback, useEffect, useState} from "react";
import {Tables} from "@/api/db/tables.ts";
import {Category} from "@/api/model/category.ts";
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faPlus, faTrash} from "@fortawesome/free-solid-svg-icons";
import {CategoryForm} from "@/components/settings/categories/category.form.tsx";
import * as yup from 'yup';
import {yupResolver} from "@hookform/resolvers/yup";
import {toast} from "sonner";
import {useTranslation} from 'react-i18next';
import i18n from '@/lib/i18n.ts';
import useApi, {SettingsData} from "@/api/db/use.api.ts";
import {ModifierGroup} from "@/api/model/modifier_group.ts";
import {Switch} from "@/components/common/input/switch.tsx";
import get from "lodash/get";
import {ModifierGroupForm} from "@/components/settings/modifier_groups/modifier_group.form.tsx";
import {StringRecordId} from "surrealdb";
import {detectMimeType, formatFileSize, MAX_UPLOAD_BYTES} from "@/utils/files";
import {Workflow} from "@/api/model/workflow.ts";
import {Kitchen} from "@/api/model/kitchen.ts";
import {WorkflowForm} from "@/components/settings/workflows/workflow.form.tsx";
import { emitEntityCrudSave } from '@/integrations/events/entity-write.ts';
import {
  includedModifiersRelateSet,
  isMaxModifiersValid,
  optionalCountSchema,
} from "@/components/settings/dishes/included-modifiers.ts";

interface Props {
  open: boolean
  onClose: () => void;
  data?: Dish
}

const validationSchema = yup.object({
  name: yup.string().required(i18n.t('validation:required')),
  number: yup.string().required(i18n.t('validation:required')),
  priority: yup.number().required(i18n.t('validation:required')).typeError(i18n.t('validation:mustBeNumber')),
  price: yup.number().required(i18n.t('validation:required')).typeError(i18n.t('validation:mustBeNumber')),
  categories: yup.array(yup.object({
    label: yup.string(),
    value: yup.string()
  })).min(1, i18n.t('validation:required')),
  modifier_groups: yup.array(yup.object({
    modifier_group: yup.object({
      label: yup.string(),
      value: yup.string()
    }).required(i18n.t('validation:required')),
    has_required_modifiers: yup.boolean(),
    required_modifiers: yup.number().when('has_required_modifiers', (has_required_modifiers, schema) => {
      if (has_required_modifiers[0]) {
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
    priority: yup.string().required(i18n.t('validation:required')),
  })),
});

export const DishForm = ({
  open, onClose, data
}: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);


  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoData, setPhotoData] = useState<ArrayBuffer | null>(null);

  const [workflowOption, setWorkflowOption] = useState<{ label: string; value: string } | null>(null);
  const [workflowStages, setWorkflowStages] = useState<any[]>([]);
  const [stageOverrides, setStageOverrides] = useState<Record<string, string>>({});

  const closeModal = () => {
    onClose();

    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoData(null);
    setWorkflowOption(null);
    setWorkflowStages([]);
    setStageOverrides({});
  }

  useEffect(() => {
    if (data) {
      reset({
        ...data,
        categories: data.categories.map(item => ({
          label: item.name,
          value: item.id
        })),
        modifier_groups: []
      });

      setPhotoFile(null);
      setPhotoData(null);
      if (data.photo) {
        const buffer = data.photo;
        const mimeType = detectMimeType(buffer, "image/png");
        const blob = new Blob([buffer], {type: mimeType});
        setPhotoPreview(URL.createObjectURL(blob));
      }

      getModifierGroups(data.id);
      loadWorkflowAssignment(data.id);
    } else {
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoData(null);
      setWorkflowOption(null);
      setWorkflowStages([]);
      setStageOverrides({});
    }
  }, [data]);

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
  } = useApi<SettingsData<ModifierGroup>>(Tables.modifier_groups, [], [], 0, 99999, ['modifiers', 'modifiers.modifier'], {
    enabled: false
  });

  const {
    data: workflows,
    fetchData: fetchWorkflows
  } = useApi<SettingsData<Workflow>>(Tables.workflows, ['deleted_at = none'], ['name asc'], 0, 99999, [], {
    enabled: false
  });

  const {
    data: kitchens,
    fetchData: fetchKitchens
  } = useApi<SettingsData<Kitchen>>(Tables.kitchens, ['deleted_at = none'], ['priority asc'], 0, 99999, [], {
    enabled: false
  });

  useEffect(() => {
    if (open) {
      fetchCategories();
      fetchModifierGroups();
      fetchWorkflows();
      fetchKitchens();
    }
  }, [open]);

  const getModifierGroups = async (id) => {
    const [record]: any = await db.query(`SELECT *
                                          from ${Tables.dish_modifier_groups}
                                          where in = ${id} fetch out, out.modifiers, out.modifiers.modifier`);


    replace(record.map(item => ({
      modifier_group: {
        label: item.out.name,
        value: item.out.id
      },
      has_required_modifiers: item.has_required_modifiers,
      required_modifiers: item.required_modifiers,
      should_auto_select: item.should_auto_select,
      should_auto_open: item.should_auto_open,
      included_modifiers: item.included_modifiers ?? null,
      max_modifiers: item.max_modifiers ?? null,
      priority: item.priority
    })));
  }

  const [categoriesModal, setCategoriesModal] = useState(false);
  const [modifierGroupsModal, setModifierGroupsModal] = useState(false);
  const [workflowModal, setWorkflowModal] = useState(false);

  const db = useDB();

  const loadStagesFor = async (workflowId: string, existingOverrides: Record<string, string> = {}) => {
    const [stages]: any = await db.query(
      `SELECT * FROM ${Tables.workflow_stages} WHERE workflow = $wf ORDER BY sequence ASC FETCH kitchen`,
      {wf: new StringRecordId(workflowId.toString())}
    );

    setWorkflowStages(stages ?? []);
    setStageOverrides(existingOverrides ?? {});
  }

  const loadWorkflowAssignment = async (dishId: string) => {
    try {
      const res: any = await db.query(
        `SELECT stage_overrides, workflow FROM $dish FETCH workflow`,
        {dish: new StringRecordId(dishId.toString())}
      );
      const row = res?.[0]?.[0];
      const overrides: Record<string, string> = {};
      if (row?.stage_overrides) {
        for (const [stageId, kitchenId] of Object.entries(row.stage_overrides)) {
          overrides[stageId] = (kitchenId as any)?.toString?.() ?? String(kitchenId);
        }
      }

      if (row?.workflow?.id) {
        setWorkflowOption({label: row.workflow.name, value: row.workflow.id.toString()});
        await loadStagesFor(row.workflow.id.toString(), overrides);
      } else {
        setWorkflowOption(null);
        setWorkflowStages([]);
        setStageOverrides({});
      }
    } catch (e) {
      console.log('Failed to load workflow assignment', e);
    }
  }

  const onWorkflowChange = async (option: { label: string; value: string } | null) => {
    setWorkflowOption(option);
    setStageOverrides({});
    if (option?.value) {
      await loadStagesFor(option.value, {});
    } else {
      setWorkflowStages([]);
    }
  }

  const {control, handleSubmit, formState: {errors}, reset, watch, getValues} = useForm({
    resolver: yupResolver(validationSchema)
  });

  const {
    fields: modifierGroupFields,
    append, remove, replace
  } = useFieldArray({
    name: 'modifier_groups',
    control: control
  });

  const onSubmit = async (values: any) => {
    try {
      const formData = {
        ...values,
        priority: parseInt(values.priority),
        price: parseFloat(values.price),
        categories: values?.categories?.map(item => new StringRecordId(item.value.toString()))
      };

      // Build per-stage kitchen overrides (only where they differ from the stage default).
      const overridesPayload: Record<string, StringRecordId> = {};
      for (const stage of workflowStages) {
        const stageId = stage.id.toString();
        const selectedKitchen = stageOverrides[stageId];
        const defaultKitchen = stage.kitchen?.id?.toString() ?? stage.kitchen?.toString();
        if (selectedKitchen && selectedKitchen !== defaultKitchen) {
          overridesPayload[stageId] = new StringRecordId(selectedKitchen);
        }
      }

      const dishData: any = {
        name: formData.name,
        number: formData.number,
        priority: formData.priority,
        price: formData.price,
        cost: 0,
        categories: formData.categories,
        workflow: workflowOption?.value ? new StringRecordId(workflowOption.value) : null,
        stage_overrides: workflowOption?.value ? overridesPayload : null,
      };


      let menuId: any;
      if (data?.id) {
        menuId = data.id;
        await db.merge(data.id, dishData);
      } else {
        const [record] = await db.create(Tables.dishes, dishData);
        menuId = record.id;
      }

      if (photoData && photoFile) {
        const [photoId] = await db.create(Tables.documents, {
          name: photoFile.name,
          content: photoData,
          size: photoFile.size,
          type: photoFile.type || undefined,
        });

        await db.merge(menuId, {
          dish_photo: photoId.id
        });
      }

      if (formData.modifier_groups) {
        // delete graph edges and create again
        await db.query(`DELETE ${menuId}->${Tables.dish_modifier_groups} where in = ${menuId}`);

        for (const modifierGroup of formData.modifier_groups) {
          const included = includedModifiersRelateSet(modifierGroup);
          await db.query(`RELATE ${menuId}->${Tables.dish_modifier_groups}->${modifierGroup.modifier_group.value} set has_required_modifiers = $has_required_modifiers, should_auto_open = $should_auto_open, required_modifiers = $required_modifiers, should_auto_select = $should_auto_select, priority = $priority${included.sql}`, {
            has_required_modifiers: modifierGroup.has_required_modifiers,
            should_auto_open: modifierGroup.should_auto_open,
            required_modifiers: modifierGroup.required_modifiers,
            should_auto_select: modifierGroup.should_auto_select,
            priority: Number(modifierGroup.priority ?? 0),
            ...included.bindings,
          });
        }
      }

      await emitEntityCrudSave({
        domain: 'manage',
        table: Tables.dishes,
        entityId: String(menuId),
        isUpdate: Boolean(data?.id),
        after: dishData,
        source: 'settings-form',
        label: values.name,
      });

      closeModal();
      toast.success(t('toast:admin.dishSaved', { name: values.name }));
    } catch (e) {
      toast.error(e);
      console.log(e)
    }
  }

  const toggleRequiredField = useCallback((index: number) => {
    return watch(`modifier_groups.${index}.has_required_modifiers`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getValues()]);

  const handlePhotoChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoData(null);
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(
        t('common:csvImport.fileTooLarge', { max: formatFileSize(MAX_UPLOAD_BYTES) })
      );
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoData(null);
      event.target.value = '';
      return;
    }

    setPhotoFile(file);

    try {
      const buffer = await file.arrayBuffer();
      setPhotoData(buffer);

      const blob = new Blob([buffer], {type: file.type || 'application/octet-stream'});
      const objectUrl = URL.createObjectURL(blob);
      setPhotoPreview(objectUrl);
    } catch (err) {
      console.log('Failed to read photo file', err);
      setPhotoData(null);
      setPhotoPreview(null);
    }
  };

  return (
    <>
      <Modal
        testId="admin-form-dish"
        title={data ? t('forms.updateDish', { name: data?.name }) : t('forms.createDish')}
        open={open}
        onClose={closeModal}
        size="full"
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <InputField name="name" control={control} label={t('forms.nameOfItem')} autoFocus error={errors?.name?.message}/>
            </div>
            <div className="flex-1">
              <InputField name="number" control={control} label={t('forms.numberOfItem')} error={errors?.number?.message}/>
            </div>
            <div className="flex-1">
              <Controller
                name="priority"
                control={control}
                render={({field}) => (
                  <Input
                    value={field.value}
                    onChange={field.onChange}
                    type="number"
                    label={t('columns.priority')}
                    error={errors?.priority?.message}
                  />
                )}
              />
            </div>
          </div>

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

          <div className="flex gap-3 mb-3 items-end">
            <div className="flex-1">
              <label>Categories</label>
              <Controller
                name="categories"
                render={({field}) => (
                  <ReactSelect
                    options={categories?.data?.map(item => ({
                      label: item.name,
                      value: item.id
                    }))}
                    isMulti
                    value={field.value}
                    onChange={field.onChange}
                    isLoading={loadingCategories}
                  />
                )}
                control={control}
              />
              {errors?.categories?.message && <InputError error={errors?.categories?.message}/>}
            </div>
            <div className="flex-0">
              <IconTooltipButton label={t('common:actions.add')} onClick={() => setCategoriesModal(true)} type="button" variant="primary"><FontAwesomeIcon icon={faPlus}/></IconTooltipButton>
            </div>
          </div>

          <div className="flex mb-3">
            <fieldset className="border-2 border-neutral-900 rounded-lg p-3 flex-1">
              <legend>Production workflow</legend>
              <div className="flex gap-2 items-end mb-3">
                <div className="flex-1">
                  <label>Workflow (leave empty to use legacy kitchen routing)</label>
                  <ReactSelect
                    isClearable
                    value={workflowOption}
                    onChange={(option: any) => onWorkflowChange(option ?? null)}
                    options={workflows?.data?.map(item => ({
                      label: item.name,
                      value: item.id.toString()
                    }))}
                  />
                </div>
                <IconTooltipButton label={t('common:actions.add')} type="button" variant="primary" onClick={() => setWorkflowModal(true)}><FontAwesomeIcon icon={faPlus}/></IconTooltipButton>
              </div>

              {workflowOption && workflowStages.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-neutral-600">
                    Stages run in order. Override a stage's kitchen for this product if needed.
                  </p>
                  {workflowStages.map((stage, index) => {
                    const stageId = stage.id.toString();
                    const defaultKitchenId = stage.kitchen?.id?.toString() ?? stage.kitchen?.toString();
                    const selectedKitchenId = stageOverrides[stageId] ?? defaultKitchenId;
                    const selectedKitchen = kitchens?.data?.find(k => k.id.toString() === selectedKitchenId);
                    return (
                      <div className="flex gap-3 items-end" key={stageId}>
                        <div className="flex-0 self-center text-neutral-500 font-bold w-6 text-center">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <Input label={t('forms.stage')} value={stage.name} disabled readOnly/>
                        </div>
                        <div className="flex-1">
                          <label>Kitchen / Station</label>
                          <ReactSelect
                            value={selectedKitchen ? {
                              label: selectedKitchen.name,
                              value: selectedKitchen.id.toString()
                            } : null}
                            onChange={(option: any) => {
                              setStageOverrides(prev => ({
                                ...prev,
                                [stageId]: option?.value ?? defaultKitchenId
                              }));
                            }}
                            options={kitchens?.data?.map(item => ({
                              label: item.name,
                              value: item.id.toString()
                            }))}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </fieldset>
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
              <div
                className="w-24 h-24 rounded-lg overflow-hidden border border-neutral-300 flex items-center justify-center bg-neutral-100">
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
              <legend>Modifier groups</legend>
              <div className="mb-3 flex gap-3">
                <Button type="button" icon={faPlus} variant="primary" onClick={() => {
                  append({
                    modifier_group: null,
                    has_required_modifiers: false,
                    required_modifiers: 0
                  })
                }}>
                  Modifier group
                </Button>

                <Button type="button" icon={faPlus} variant="primary" flat onClick={() => {
                  setModifierGroupsModal(true)
                }}>
                  Create modifier group
                </Button>
              </div>

              {modifierGroupFields.map((item, index) => (
                <div className="flex gap-3 mb-3" key={item.id}>
                  <div className="flex-1">
                    <label htmlFor="group">Modifier group</label>
                    <Controller
                      name={`modifier_groups.${index}.modifier_group`}
                      control={control}
                      render={({field}) => (
                        <ReactSelect
                          value={field.value}
                          onChange={field.onChange}
                          isLoading={loadingModifierGroups}
                          options={modifierGroups?.data?.map(item => ({
                            label: item.name,
                            value: item.id,
                            modifiers: item.modifiers
                          }))}
                        />
                      )}
                    />
                    <InputError error={get(errors, ['modifier_groups', index, 'modifier_group', 'message'])}/>
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.should_auto_select`}
                      control={control}
                      render={({field}) => (
                        <Switch checked={field.value} onChange={field.onChange}>
                          Auto select modifiers?
                        </Switch>
                      )}
                    />
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.should_auto_open`}
                      control={control}
                      render={({field}) => (
                        <Switch checked={field.value} onChange={field.onChange}>
                          Auto open modifiers?
                        </Switch>
                      )}
                    />
                  </div>
                  <div className="flex-1 self-end">
                    <Controller
                      name={`modifier_groups.${index}.has_required_modifiers`}
                      control={control}
                      render={({field}) => (
                        <Switch checked={field.value} onChange={field.onChange}>
                          Has required modifiers
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
                          type="number" value={field.value} onChange={field.onChange}
                          label={t('forms.requiredModifiers')}
                          disabled={!toggleRequiredField(index)}
                          error={get(errors, ['modifier_groups', index, 'required_modifiers', 'message'])}
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
                          type="number" min={0} value={field.value ?? ''} onChange={field.onChange}
                          label={t('forms.includedModifiers')}
                          title={t('forms.includedModifiersHint')}
                          error={get(errors, ['modifier_groups', index, 'included_modifiers', 'message'])}
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
                          type="number" min={0} value={field.value ?? ''} onChange={field.onChange}
                          label={t('forms.maxModifiers')}
                          title={t('forms.maxModifiersHint')}
                          disabled={!Number(watch(`modifier_groups.${index}.included_modifiers`))}
                          error={get(errors, ['modifier_groups', index, 'max_modifiers', 'message'])}
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
                          type="number" value={field.value} onChange={field.onChange}
                          label={t('columns.priority')}
                          error={get(errors, ['modifier_groups', index, 'priority', 'message'])}
                        />
                      )}
                    />
                  </div>
                  <div className="flex-0 self-end">
                    <IconTooltipButton label={t('common:actions.remove')} variant="danger" onClick={() => remove(index)}><FontAwesomeIcon icon={faTrash}/></IconTooltipButton>
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
  )
}
