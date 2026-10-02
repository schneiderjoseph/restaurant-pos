import { Modal } from "@/components/common/react-aria/modal.tsx";
import { Input } from "@/components/common/input/input.tsx";
import { InputField } from "@/components/common/form/rhf-fields.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { Controller, useForm } from "react-hook-form";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import { Outlet } from "@/api/model/outlet.ts";
import { toast } from "sonner";
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n.ts";
import { emitEntityCrudSave } from "@/integrations/events/entity-write.ts";

interface Props {
  open: boolean;
  onClose: () => void;
  data?: Outlet;
}

const validationSchema = yup.object({
  name: yup.string().required(i18n.t("validation:required")),
  priority: yup.string().required(i18n.t("validation:required")).typeError(i18n.t("validation:mustBeNumber")),
  color: yup.string().nullable().optional(),
});

export const OutletForm = ({ open, onClose, data }: Props) => {
  const { t } = useTranslation(["admin", "common", "validation", "toast"]);
  const db = useDB();

  const { control, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: yupResolver(validationSchema),
  });

  const closeModal = () => {
    onClose();
    reset({
      name: null,
      priority: null,
      color: null,
    });
  };

  useEffect(() => {
    if (data) {
      reset({
        name: data.name,
        priority: data.priority?.toString(),
        color: data.color ?? "#000000",
      });
    }
  }, [data, reset]);

  const onSubmit = async (values: any) => {
    const vals = {
      name: values.name,
      priority: parseInt(values.priority, 10),
      color: values.color || null,
    };

    try {
      if (data?.id) {
        await db.update(data.id, vals);
      } else {
        await db.create(Tables.outlets, vals);
      }

      await emitEntityCrudSave({
        domain: "manage",
        table: Tables.outlets,
        entityId: data?.id ? String(data.id) : Tables.outlets,
        isUpdate: Boolean(data?.id),
        source: "settings-form",
      });

      closeModal();
      toast.success(t("toast:admin.outletSaved", { name: values.name }));
    } catch (e) {
      toast.error(e);
      console.log(e);
    }
  };

  return (
    <Modal
      testId="admin-form-outlet"
      title={data ? t("forms.updateOutlet", { name: data?.name }) : t("forms.createOutlet")}
      open={open}
      onClose={closeModal}
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <div className="flex gap-3 mb-3">
          <div className="flex-1">
            <InputField
              name="name"
              control={control}
              label={t("columns.name")}
              autoFocus
              error={errors?.name?.message}
            />
          </div>
          <div className="flex-1">
            <Controller
              name="priority"
              control={control}
              render={({ field }) => (
                <Input
                  type="number"
                  label={t("columns.priority")}
                  error={errors?.priority?.message}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </div>
        <div className="mb-3">
          <InputField
            type="color"
            name="color"
            control={control}
            label={t("forms.outletColor")}
            error={errors?.color?.message}
          />
        </div>
        <div>
          <Button type="submit" variant="primary">{t("common:actions.save")}</Button>
        </div>
      </form>
    </Modal>
  );
};
