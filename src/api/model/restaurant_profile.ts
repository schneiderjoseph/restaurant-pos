export const RESTAURANT_PROFILE_KEY = 'restaurant_profile';

export interface RestaurantProfile {
  name: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  taxId: string;
  /** Binary logo for tickets + reports (PNG/JPEG). */
  logo?: ArrayBuffer | Uint8Array | number[] | string | null;
}

export const DEFAULT_RESTAURANT_PROFILE: RestaurantProfile = {
  name: (import.meta.env.VITE_RESTAURANT_NAME as string | undefined)?.trim() || '',
  address: (import.meta.env.VITE_RESTAURANT_ADDRESS as string | undefined)?.trim() || '',
  phone: (import.meta.env.VITE_RESTAURANT_PHONE as string | undefined)?.trim() || '',
  email: (import.meta.env.VITE_RESTAURANT_EMAIL as string | undefined)?.trim() || '',
  website: (import.meta.env.VITE_RESTAURANT_WEBSITE as string | undefined)?.trim() || '',
  taxId: (import.meta.env.VITE_RESTAURANT_TAX_ID as string | undefined)?.trim() || '',
  logo: null,
};
