import { useEffect, useSyncExternalStore } from 'react';
import { useDB } from '@/api/db/db.ts';
import {
  fetchRestaurantProfile,
  getCachedRestaurantLogoDataUrl,
  getCachedRestaurantProfile,
  getRestaurantProfileSnapshot,
  subscribeRestaurantProfile,
} from '@/lib/restaurant-profile.ts';

/** Load + subscribe to restaurant branding for reports / receipts. */
export function useRestaurantProfile() {
  const db = useDB();
  const snapshot = useSyncExternalStore(
    subscribeRestaurantProfile,
    getRestaurantProfileSnapshot
  );

  useEffect(() => {
    void fetchRestaurantProfile(db).catch(() => undefined);
  }, [db]);

  // snapshot forces re-render after settings hydrate
  void snapshot;

  return {
    profile: getCachedRestaurantProfile(),
    logoDataUrl: getCachedRestaurantLogoDataUrl(),
  };
}
