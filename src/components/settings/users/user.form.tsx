import { Modal } from "@/components/common/react-aria/modal.tsx";
import { InputField } from "@/components/common/form/rhf-fields.tsx";
import { Button } from "@/components/common/input/button.tsx";
import { IconTooltipButton } from "@/components/common/input/icon.tooltip.button.tsx";
import { Controller, useForm } from "react-hook-form";
import { useDB } from "@/api/db/db.ts";
import { Tables } from "@/api/db/tables.ts";
import { toast } from 'sonner';
import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { useEffect, useState } from "react";
import { User } from "@/api/model/user.ts";
import { ReactSelect } from "@/components/common/input/custom.react.select.tsx";
import useApi, { SettingsData } from "@/api/db/use.api.ts";
import { UserRole } from "@/api/model/user_role.ts";
import { Shift } from "@/api/model/shift.ts";
import { StringRecordId } from "surrealdb";
import {useTranslation} from 'react-i18next';
import i18n from '@/lib/i18n.ts';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faRotate } from "@fortawesome/free-solid-svg-icons";
import { UserRoleForm } from "@/components/settings/users/roles/role.form.tsx";
import { ShiftForm } from "@/components/settings/users/shifts/shift.form.tsx";
import { findActiveLoginOwner, generateFreePin } from "@/components/settings/users/user.login.ts";

interface Props {
  open: boolean
  onClose: () => void;
  data?: User
}

// PIN is the only login method: login is the 4-digit PIN.
const pinField = yup.string().matches(/^\d{4}$/, {
  message: "PIN must be exactly 4 digits only.",
  excludeEmptyString: true,
});

// Nobody sees an existing user's PIN: editing leaves it empty (= unchanged) unless reset.
const makeValidationSchema = (isEdit: boolean) => yup.object({
  first_name: yup.string().required(i18n.t('validation:required')),
  last_name: yup.string().required(i18n.t('validation:required')),
  login: isEdit ? pinField.nullable() : pinField.required(i18n.t('validation:required')),
  user_role: yup.object({
    label: yup.string(),
    value: yup.string(),
  }).nullable().required('This is required'),
  user_shift: yup.object({
    label: yup.string(),
    value: yup.string(),
  }).nullable().default(null),
});

export const UserForm = ({
  open, onClose, data
}: Props) => {
  const { t } = useTranslation(['admin', 'common', 'validation', 'toast']);

  const isEdit = Boolean(data?.id);
  const { control, handleSubmit, formState: { errors }, reset, setValue, watch } = useForm({
    resolver: yupResolver(makeValidationSchema(isEdit)),
  });
  const newPin = watch("login");

  const closeModal = () => {
    onClose();
    reset({
      first_name: null,
      last_name: null,
      login: null,
      user_role: null,
      user_shift: null,
    });
  }

  useEffect(() => {
    if( data ) {
      reset({
        ...data,
        first_name: data.first_name,
        last_name: data.last_name,
        login: null,
        user_role: data?.user_role ? {
          label: data.user_role.name,
          value: data.user_role.id,
        } : null,
        user_shift: (data as any)?.user_shift ? {
          label: (data as any)?.user_shift?.name,
          value: (data as any)?.user_shift?.id,
        } : null,
      });
    }
  }, [data, reset]);

  const db = useDB();
  const {
    data: roleData,
    fetchData: fetchRoles,
  } = useApi<SettingsData<UserRole>>(Tables.user_roles, [], ["name asc"], 0, 99999, [], {
    enabled: false,
  });
  const {
    data: shiftData,
    fetchData: fetchShifts,
  } = useApi<SettingsData<Shift>>(Tables.shifts, [], ["name asc"], 0, 99999, [], {
    enabled: false,
  });
  const onSubmit = async (values: any) => {
    const vals = { ...values };
    const selectedRoleId = values.user_role?.value;
    // Compare as strings: the edited user's role id and the option ids are different RecordId instances.
    const selectedRole = (roleData?.data || []).find((item) => String(item.id) === String(selectedRoleId));
    const selectedRoleModules = [...new Set(selectedRole?.roles || [])];

    vals.user_role = selectedRoleId ? new StringRecordId(selectedRoleId) : null;
    vals.roles = selectedRoleModules;
    vals.user_shift = values.user_shift?.value ? new StringRecordId(values.user_shift.value) : null;
    // Saving a user written before PIN-only login converts it to PIN.
    vals.login_method = "pin";
    vals.password = vals.login;
    const pinChanged = Boolean(vals.login);

    const displayName = `${values.first_name} ${values.last_name}`;

    try {
      // Generic message: naming the holder would tell who owns which PIN.
      if (pinChanged && await findActiveLoginOwner(db, vals.login, data?.id)) {
        toast.error(t('toast:admin.pinTaken'));
        return;
      }

      if( data?.id ) {
        const pinSet = pinChanged ? ', login = $login, password = crypto::bcrypt::generate($password)' : '';
        await db.query(`UPDATE ${data.id} set first_name = $first_name, last_name = $last_name, login_method = $login_method${pinSet}, roles = $roles, user_role = $user_role, user_shift = $user_shift`, {
          ...vals
        });

        closeModal();
        toast.success(t('toast:admin.userSaved', { name: displayName }));
      } else {
        const userParams = {
          first_name: vals.first_name,
          last_name: vals.last_name,
          login: vals.login,
          login_method: vals.login_method,
          password: vals.password,
          roles: vals.roles,
          user_role: vals.user_role,
          user_shift: vals.user_shift,
        };

        await db.query(
          `INSERT INTO user (first_name, last_name, login, login_method, password, roles, user_role, user_shift) VALUES ($first_name, $last_name, $login, $login_method, crypto::bcrypt::generate($password), $roles, $user_role, $user_shift)`,
          userParams,
        );
        closeModal();
        toast.success(t('toast:admin.userSaved', { name: displayName }));
      }
    } catch ( e ) {
      toast.error(e instanceof Error ? e.message : String(e));
      console.log(e)
    }
  }

  const fillFreePin = async () => {
    try {
      const pin = await generateFreePin(db);
      if (pin) {
        setValue("login", pin, { shouldValidate: true });
      }
    } catch (e) {
      console.error('PIN generation failed', e);
    }
  };

  useEffect(() => {
    if (open) {
      fetchRoles();
      fetchShifts();
    }
  }, [open, fetchRoles, fetchShifts]);

  // A new user starts with a free PIN; it stays editable.
  useEffect(() => {
    if (open && !data) {
      void fillFreePin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening; db identity changes every render
  }, [open, data]);

  const [roleModal, setRoleModal] = useState(false);
  const [shiftModal, setShiftModal] = useState(false);

  return (
    <>
      <Modal
        testId="admin-form-user"
        title={data ? t('forms.updateUser', { name: `${data?.first_name} ${data?.last_name}` }) : t('forms.createUser')}
        open={open}
        onClose={closeModal}
      >
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="flex gap-3 flex-col mb-3">
            <div className="flex-1">
              <InputField name="first_name" control={control} label={t('columns.firstName')} autoFocus error={errors?.first_name?.message}/>
            </div>
            <div className="flex-1">
              <InputField name="last_name" control={control} label={t('columns.lastName')} error={errors?.last_name?.message}/>
            </div>
            <div>
              <div className="flex gap-2 items-end">
                <div className="flex-1">
                  {/* Read-only: a typed PIN would let anyone probe which PINs are taken. */}
                  <InputField name="login" control={control} label={t('auth:security.pin')} readOnly placeholder="••••" error={errors?.login?.message}/>
                </div>
                <IconTooltipButton label={isEdit ? t('forms.resetPin') : t('forms.generatePin')} type="button" variant="primary" onClick={() => void fillFreePin()}><FontAwesomeIcon icon={faRotate}/></IconTooltipButton>
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                {newPin ? t('forms.newPinHint') : t('forms.pinHidden')}
              </p>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label htmlFor="user_role">Role</label>
                <Controller
                  name="user_role"
                  control={control}
                  render={({field}) => (
                    <ReactSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={(roleData?.data || []).map(item => ({
                        label: item.name,
                        value: item.id
                      }))}
                    />
                  )}
                />
                <span className="text-danger-600 text-sm">{errors?.user_role?.message as string}</span>
              </div>
              <IconTooltipButton label={t('common:actions.add')} type="button" variant="primary" onClick={() => setRoleModal(true)}><FontAwesomeIcon icon={faPlus}/></IconTooltipButton>
            </div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label htmlFor="user_shift">Shift</label>
                <Controller
                  name="user_shift"
                  control={control}
                  render={({field}) => (
                    <ReactSelect
                      value={field.value}
                      onChange={field.onChange}
                      options={(shiftData?.data || []).map(item => ({
                        label: item.name,
                        value: item.id
                      }))}
                      isClearable
                    />
                  )}
                />
              </div>
              <IconTooltipButton label={t('common:actions.add')} type="button" variant="primary" onClick={() => setShiftModal(true)}><FontAwesomeIcon icon={faPlus}/></IconTooltipButton>
            </div>
          </div>

          <div>
            <Button type="submit" variant="primary">{t('common:actions.save')}</Button>
          </div>
        </form>
      </Modal>

      {roleModal && (
        <UserRoleForm
          open={true}
          onClose={() => {
            fetchRoles();
            setRoleModal(false);
          }}
        />
      )}
      {shiftModal && (
        <ShiftForm
          open={true}
          onClose={() => {
            fetchShifts();
            setShiftModal(false);
          }}
        />
      )}
    </>
  )
}
