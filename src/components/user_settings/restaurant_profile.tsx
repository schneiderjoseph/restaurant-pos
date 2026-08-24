import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Controller, useForm } from "react-hook-form";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTimes } from "@fortawesome/free-solid-svg-icons";
import { useDB } from "@/api/db/db.ts";
import { toast } from "sonner";
import { useSecurity } from "@/hooks/useSecurity.ts";
import {
  DEFAULT_RESTAURANT_PROFILE,
  type RestaurantProfile,
} from "@/api/model/restaurant_profile.ts";
import {
  fetchRestaurantProfile,
  logoToDataUrl,
  saveRestaurantProfile,
} from "@/lib/restaurant-profile.ts";
import { assertFileWithinLimit, MAX_LOGO_UPLOAD_BYTES } from "@/utils/files.ts";
import { useTranslation } from "react-i18next";

interface FormValues {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
}

export const RestaurantProfileSettingsCard = () => {
  const db = useDB();
  const { protectFormSubmit } = useSecurity();
  const { t } = useTranslation(["settings", "common"]);
  const [settingId, setSettingId] = useState<string>();
  const [existingLogo, setExistingLogo] = useState<RestaurantProfile["logo"]>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [logoBuffer, setLogoBuffer] = useState<ArrayBuffer | null>(null);
  const [logoRemoved, setLogoRemoved] = useState(false);

  const { control, handleSubmit, reset } = useForm<FormValues>({
    defaultValues: {
      name: DEFAULT_RESTAURANT_PROFILE.name,
      address: DEFAULT_RESTAURANT_PROFILE.address,
      phone: DEFAULT_RESTAURANT_PROFILE.phone,
      email: DEFAULT_RESTAURANT_PROFILE.email,
      website: DEFAULT_RESTAURANT_PROFILE.website,
      taxId: DEFAULT_RESTAURANT_PROFILE.taxId,
    },
  });

  const existingLogoUrl = useMemo(
    () => (logoRemoved ? null : logoToDataUrl(existingLogo)),
    [existingLogo, logoRemoved]
  );
  const currentLogoUrl = logoPreview || existingLogoUrl;

  const loadSettings = async () => {
    const { settingId: id, profile } = await fetchRestaurantProfile(db);
    setSettingId(id);
    setExistingLogo(profile.logo ?? null);
    setLogoBuffer(null);
    setLogoRemoved(false);
    if (logoPreview) {
      URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
    }
    reset({
      name: profile.name,
      address: profile.address,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      taxId: profile.taxId,
    });
  };

  const handleLogoChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    try {
      assertFileWithinLimit(file, MAX_LOGO_UPLOAD_BYTES);
      const buffer = await file.arrayBuffer();
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      const objectUrl = URL.createObjectURL(new Blob([buffer], { type: file.type || "image/png" }));
      setLogoBuffer(buffer);
      setLogoPreview(objectUrl);
      setLogoRemoved(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("settings:restaurantProfile.logoError"));
      setLogoBuffer(null);
      if (logoPreview) {
        URL.revokeObjectURL(logoPreview);
        setLogoPreview(null);
      }
    }
  };

  const handleRemoveLogo = () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoPreview(null);
    setLogoBuffer(null);
    setLogoRemoved(true);
  };

  const saveSettings = async (values: FormValues) => {
    let logo: RestaurantProfile["logo"] = null;
    if (logoRemoved) {
      logo = null;
    } else if (logoBuffer) {
      logo = logoBuffer;
    } else {
      logo = existingLogo ?? null;
    }

    await saveRestaurantProfile(
      db,
      {
        ...values,
        logo,
      },
      settingId
    );
    toast.success(t("settings:restaurantProfile.updated"));
    await loadSettings();
  };

  useEffect(() => {
    void loadSettings().catch(() => undefined);
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="shadow p-5 rounded-xl bg-white" data-testid="settings-card-restaurant-profile">
      <h2 className="text-xl font-semibold mb-1">{t("settings:restaurantProfile.title")}</h2>
      <p className="text-sm text-neutral-500 mb-5">
        {t("settings:restaurantProfile.description")}
      </p>
      <form
        onSubmit={protectFormSubmit(handleSubmit(saveSettings), {
          module: "settings.restaurant_profile",
          description: t("settings:restaurantProfile.saveDescription"),
        })}
      >
        <div className="grid grid-cols-1 gap-4 mb-5">
          <Controller
            name="name"
            control={control}
            render={({ field }) => (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("settings:restaurantProfile.name")}
                </label>
                <input className="input input-bordered w-full" {...field} />
              </div>
            )}
          />
          <Controller
            name="address"
            control={control}
            render={({ field }) => (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("settings:restaurantProfile.address")}
                </label>
                <textarea className="textarea textarea-bordered w-full min-h-20" {...field} />
              </div>
            )}
          />
          <Controller
            name="phone"
            control={control}
            render={({ field }) => (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("settings:restaurantProfile.phone")}
                </label>
                <input className="input input-bordered w-full" type="tel" {...field} />
              </div>
            )}
          />
          <Controller
            name="email"
            control={control}
            render={({ field }) => (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("settings:restaurantProfile.email")}
                </label>
                <input className="input input-bordered w-full" type="email" {...field} />
              </div>
            )}
          />
          <Controller
            name="website"
            control={control}
            render={({ field }) => (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("settings:restaurantProfile.website")}
                </label>
                <input className="input input-bordered w-full" type="url" {...field} />
              </div>
            )}
          />
          <Controller
            name="taxId"
            control={control}
            render={({ field }) => (
              <div>
                <label className="text-sm font-medium mb-1 block">
                  {t("settings:restaurantProfile.taxId")}
                </label>
                <input className="input input-bordered w-full" {...field} />
              </div>
            )}
          />
          <div>
            <p className="text-sm font-medium mb-2">{t("settings:restaurantProfile.logo")}</p>
            <p className="text-xs text-neutral-500 mb-2">
              {t("settings:restaurantProfile.logoHint")}
            </p>
            {currentLogoUrl ? (
              <div className="relative inline-block">
                <img
                  src={currentLogoUrl}
                  alt={t("settings:restaurantProfile.logoPreview")}
                  className="max-h-20 max-w-full object-contain border border-neutral-300 rounded p-2"
                />
                <button
                  type="button"
                  onClick={handleRemoveLogo}
                  className="absolute -top-2 -right-2 bg-danger-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-danger-600 transition-colors"
                  aria-label={t("settings:restaurantProfile.removeLogo")}
                >
                  <FontAwesomeIcon icon={faTimes} size="xs" />
                </button>
              </div>
            ) : (
              <input
                type="file"
                accept="image/*"
                className="input"
                onChange={(e) => void handleLogoChange(e)}
              />
            )}
          </div>
        </div>
        <button className="btn btn-primary" type="submit">
          {t("common:actions.save")}
        </button>
      </form>
    </div>
  );
};
