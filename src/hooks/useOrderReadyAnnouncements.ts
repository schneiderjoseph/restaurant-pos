import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Order } from '@/api/model/order.ts';
import { formatOrderNumber, getInvoiceNumber } from '@/lib/order.ts';
import {
  cancelOrderReadySpeech,
  speakOrderReady,
} from '@/lib/order-ready-announcement.ts';

interface CelebrationItem {
  id: string;
  /** Plain number, for speech and the sentence under the big number. */
  orderNumber: string;
  /** Formatted display number for the popup (#012). */
  displayNumber: string;
}

/**
 * @param readyOrders every ready order, not only the ones on screen.
 * @param preparingOrders orders back in preparation are forgotten, so they are announced
 *   again when ready.
 * @param hydrated false until the list for the current filters has loaded; what is
 *   already ready at that point is the baseline, not an announcement.
 */
export const useOrderReadyAnnouncements = (
  readyOrders: Order[],
  preparingOrders: Order[] = [],
  hydrated = true
) => {
  const { t, i18n } = useTranslation('order-display');
  const knownReadyIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationItem[]>([]);
  const [activeCelebration, setActiveCelebration] = useState<CelebrationItem | null>(null);
  const [highlightedOrderIds, setHighlightedOrderIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!hydrated) {
      initializedRef.current = false;
      return;
    }

    if (!initializedRef.current) {
      initializedRef.current = true;
      knownReadyIdsRef.current = new Set(readyOrders.map((order) => order.id.toString()));
      return;
    }

    const known = knownReadyIdsRef.current;
    preparingOrders.forEach((order) => known.delete(order.id.toString()));
    const newlyReady = readyOrders.filter((order) => !known.has(order.id.toString()));
    newlyReady.forEach((order) => known.add(order.id.toString()));

    if (newlyReady.length === 0) {
      return;
    }

    const celebrations = newlyReady.map((order) => {
      const spokenNumber = getInvoiceNumber(order);
      const displayNumber = formatOrderNumber(order);
      speakOrderReady(
        t('orderReadyAnnouncement', { number: spokenNumber }),
        i18n.language
      );

      return {
        id: order.id.toString(),
        orderNumber: spokenNumber,
        displayNumber,
      };
    });

    setCelebrationQueue((prev) => [...prev, ...celebrations]);
    setHighlightedOrderIds((prev) => {
      const next = new Set(prev);
      celebrations.forEach((item) => next.add(item.id));
      return next;
    });
  }, [readyOrders, preparingOrders, hydrated, t, i18n.language]);

  useEffect(() => {
    if (activeCelebration || celebrationQueue.length === 0) {
      return;
    }

    const [next, ...rest] = celebrationQueue;
    setActiveCelebration(next);
    setCelebrationQueue(rest);
  }, [activeCelebration, celebrationQueue]);

  useEffect(() => () => cancelOrderReadySpeech(), []);

  const completeCelebration = useCallback(() => {
    setActiveCelebration((current) => {
      if (!current) {
        return current;
      }

      const completedId = current.id;
      window.setTimeout(() => {
        setHighlightedOrderIds((prev) => {
          const next = new Set(prev);
          next.delete(completedId);
          return next;
        });
      }, 1200);

      return null;
    });
  }, []);

  return {
    activeCelebration,
    completeCelebration,
    highlightedOrderIds,
  };
};
