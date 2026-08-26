import { Printer } from "@/api/model/printer.ts";
import { useEffect } from "react";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import {Controller, useForm, useWatch} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {useTranslation} from 'react-i18next';
import i18n from '@/lib/i18n.ts';
import { Modal } from "@/components/common/react-aria/modal.tsx";
import { Input } from "@/components/common/input/input.tsx";
import { InputField } from "@/components/common/form/rhf-fields.tsx";
import { Button } from "@/components/common/input/button.tsx";
import * as z from "zod";
import { transformValue } from "@/lib/utils.ts";
import {ReactSelect} from "@/components/common/input/custom.react.select.tsx";

import { emitEntityCrudSave } from '@/integrations/events/entity-write.ts';
interface Props {
  open: boolean
  onClose: () => void;
  data?: Printer
}

const validationSchema = z.object({
  name: z.string().min(1, i18n.t('validation:required')),
  ip_address: z.string().optional(),
  port: z.number({message: i18n.t('validation:invalidPort')}).optional(),
  type: z.object({
    label: z.string(),
    value: z.string()
  }).nullable().optional(),
  vid: z.string().optional(),
  pid: z.string().optional()
});

export const PrinterForm = ({
  open, onClose, data
}: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);

  const closeModal = () => {
    onClose();
  }

  const { control, handleSubmit, formState: {errors}, reset } = useForm({
    resolver: zodResolver(validationSchema),
    defaultValues: {
      name: '',
      ip_address: '',
      port: 9100,
      type: null as { label: string; value: string } | null,
      vid: '',
      pid: '',
      path: '',
    },
  });

  useEffect(() => {
    if (data) {
      reset({
        name: data.name ?? '',
        priority: data.priority,
        ip_address: data.ip_address ?? '',
        port: data.port ?? 9100,
        type: data.type ? {
          label: data.type,
          value: data.type,
        } : null,
        vid: data.vid ?? '',
        pid: data.pid ?? '',
      });
    } else {
      reset({
        name: '',
        ip_address: '',
        port: 9100,
        type: null,
        vid: '',
        pid: '',
        path: '',
      });
    }
  }, [data, reset]);

  const db = useDB();

  const onSubmit = async (values: any) => {
    const printerType = values?.type ? values.type.value : null;
    // Schema has no `path` field — Serial/Bluetooth device path is stored in ip_address.
    const address =
      printerType === 'Serial' || printerType === 'Bluetooth'
        ? (values.path || values.ip_address || null)
        : (values.ip_address || null);

    // Schema still requires `prints` (int); copy count moved to global print_options.
    const vals: Record<string, unknown> = {
      name: values.name,
      type: printerType,
      ip_address: address,
      port: printerType === 'Network' ? (values.port ?? 9100) : (values.port ?? null),
      vid: printerType === 'USB' ? (values.vid || null) : null,
      pid: printerType === 'USB' ? (values.pid || null) : null,
      prints: typeof data?.prints === 'number' ? data.prints : 1,
      priority: values.priority ?? 0,
    };

    try {
      if(data?.id){
        await db.update(data.id, {
          ...vals,
        })
      }else{
        await db.create(Tables.printers, {
          ...vals
        });
      }

      
      await emitEntityCrudSave({
        domain: 'manage',
        table: Tables.printers,
        entityId: data?.id ? String(data.id) : Tables.printers,
        isUpdate: Boolean(data?.id),
        source: 'settings-form',
      });

      closeModal();
      toast.success(t('toast:admin.printerSaved', { name: values.name }));
    }catch(e){
      const message = e instanceof Error ? e.message : String(e);
      toast.error(message);
      console.error(e);
    }
  }

  const type = useWatch({
    name: 'type',
    control: control
  })

  return (
    <>
      <Modal
        testId="admin-form-printer"
        title={data ? t('forms.updatePrinter', { name: data?.name }) : t('forms.createPrinter')}
        open={open}
        onClose={closeModal}
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-3 mb-3 flex-col">
            <div className="flex-1">
              <InputField name="name" control={control} label={t('columns.name')} autoFocus error={errors?.name?.message}/>
            </div>
            <div className="flex-1">
              <label htmlFor="type">{t('columns.type')}</label>
              <Controller
                render={({field}) => (
                  <ReactSelect
                    value={field.value}
                    onChange={field.onChange}
                    options={['Network', 'USB', 'Serial', 'Bluetooth'].map(item => ({
                      label: item,
                      value: item
                    }))}
                  />
                )}
                name="type"
                control={control}
              />
            </div>
            {type?.value === 'Network' && (
              <div className="flex-1 flex gap-3">
                <div className="flex-1">
                  <Controller
                    name="ip_address"
                    control={control}
                    render={({field}) => (
                      <Input
                        label={t('columns.path')}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        error={errors?.ip_address?.message}/>
                    )}
                  />

                </div>
                <div className="flex-1">
                  <Controller
                    render={({ field }) => (
                      <Input
                        type="number"
                        label={t('columns.port')}
                        error={errors?.port?.message}
                        value={transformValue.input(field.value)}
                        onChange={(e) => field.onChange(transformValue.output(e))}
                      />
                    )}
                    name="port"
                    control={control}
                  />
                </div>
              </div>
            )}

            {type?.value === 'USB' && (
              <div className="flex-1 flex gap-3">
                <div className="flex-1">
                  <Controller
                    name="vid"
                    control={control}
                    render={({field}) => (
                      <Input
                        label={t('forms.vid')}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        error={errors?.vid?.message}/>
                    )}
                  />

                </div>
                <div className="flex-1">
                  <Controller
                    render={({ field }) => (
                      <Input
                        label={t('forms.pid')}
                        error={errors?.pid?.message}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                      />
                    )}
                    name="pid"
                    control={control}
                  />
                </div>
              </div>
            )}

            {(type?.value === 'Bluetooth' || type?.value === 'Serial') && (
              <div className="flex-1 flex gap-3">
                <div className="flex-1">
                  <Controller
                    name="path"
                    control={control}
                    render={({field}) => (
                      <Input
                        label={t('columns.path')}
                        value={field.value ?? ''}
                        onChange={field.onChange}
                        error={errors?.path?.message}/>
                    )}
                  />
                </div>
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
