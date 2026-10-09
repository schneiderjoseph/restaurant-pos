import { useEffect, useMemo, useState } from 'react';
import { useAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { appSettings, appState } from '@/store/jotai.ts';
import { applyCategoryHours } from '@/lib/category-hours.ts';
import { isRoomGuest } from '@/lib/guest.ts';
import { nowInAppTimezone } from '@/lib/datetime.ts';

const minutesNow = () => {
  const now = nowInAppTimezone();
  return now.hour * 60 + now.minute;
};

/**
 * Keeps the cart in step with the category hours (lib/category-hours.ts): breakfast free for the
 * room guest, the walk-in price on the plates for anyone else. Runs on every cart or guest change
 * and twice a minute, so a cart still open at 10:00 goes to the walk-in price.
 */
export const useCategoryHours = () => {
  const {t} = useTranslation('menu');
  const [state, setState] = useAtom(appState);
  const [settings] = useAtom(appSettings);
  const [minutes, setMinutes] = useState(minutesNow);

  const managed = useMemo(
    () => (settings.categories ?? []).filter((category) => category.room_included === true),
    [settings.categories],
  );

  useEffect(() => {
    if (managed.length === 0) {
      return;
    }
    const timer = window.setInterval(() => setMinutes(minutesNow()), 30_000);
    return () => window.clearInterval(timer);
  }, [managed.length]);

  const roomGuest = state.customer ? isRoomGuest(state.customer) : false;
  const roomIncludedLabel = t('categoryHours.roomIncluded', {defaultValue: 'Inclus chambre'});

  useEffect(() => {
    if (managed.length === 0) {
      return;
    }
    setState((prev) => {
      const cart = applyCategoryHours(prev.cart ?? [], {
        categories: managed,
        roomGuest,
        minutes,
        roomIncludedLabel,
      });
      return cart === prev.cart ? prev : {...prev, cart};
    });
  }, [state.cart, managed, roomGuest, minutes, roomIncludedLabel, setState]);
};
