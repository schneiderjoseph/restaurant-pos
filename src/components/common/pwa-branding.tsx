import { useEffect } from 'react';
import {
  getCachedRestaurantLogoDataUrl,
  getCachedRestaurantProfile,
  getStoredLoginLogo,
  subscribeRestaurantProfile,
} from '@/lib/restaurant-profile.ts';
import { applyPwaBranding } from '@/lib/pwa-branding.ts';

/**
 * Keeps the PWA / favicon icons in sync with restaurant branding.
 * Uses the cached login logo before sign-in; switches to the profile logo after load/save.
 */
export function PwaBranding() {
  useEffect(() => {
    const apply = () => {
      const logo =
        getCachedRestaurantLogoDataUrl() ?? getStoredLoginLogo() ?? null;
      const name = getCachedRestaurantProfile().name;
      void applyPwaBranding({ name, logoSrc: logo });
    };

    apply();
    return subscribeRestaurantProfile(apply);
  }, []);

  return null;
}
