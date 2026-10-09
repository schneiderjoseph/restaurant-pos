import {lineDisplayName} from "@/lib/dish-selling.ts";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KitchenOrder } from '@/api/model/kitchen.ts';
import { getInvoiceNumber } from '@/lib/order.ts';
import { formatKitchenPlaceLabel, type KitchenPlaceLabels } from '@/lib/kitchen-ticket-label.ts';
import {
  cancelOrderReadySpeech,
  playReadyChime,
  speakOrderReady,
  unlockReadyChime,
  unlockSpeech,
} from '@/lib/order-ready-announcement.ts';

const HIGHLIGHT_MS = 18_000;

type ItemSnapshot = {
  id: string
  deleted: boolean
  name: string
  orderNumber: string
  context: string
  batchKey: string
  isAddonBatch: boolean
};

type BatchSnapshot = {
  batchKey: string
  isAddon: boolean
  orderNumber: string
  context: string
};

/** Spoken place words, so R20 is read "Chambre 20" and T7 "Table 7". */
const orderContext = (group: KitchenOrder, labels: KitchenPlaceLabels) => {
  const orderNumber = group.order ? getInvoiceNumber(group.order) : '-';
  const table = group.order?.table;
  const tableLabel = formatKitchenPlaceLabel(table, labels);
  const context = tableLabel || group.order?.order_type?.name || orderNumber;
  return { orderNumber, context };
};

const snapshotFromOrders = (orders: KitchenOrder[], labels: KitchenPlaceLabels) => {
  const batches = new Map<string, BatchSnapshot>();
  const items = new Map<string, ItemSnapshot>();

  for (const group of orders) {
    const { orderNumber, context } = orderContext(group, labels);

    for (const batch of group.batches) {
      const isAddon = batch.items.some((item) => item.order_item?.is_addition);
      batches.set(batch.batchKey, {
        batchKey: batch.batchKey,
        isAddon,
        orderNumber,
        context,
      });

      for (const stage of batch.items) {
        const id = stage.id?.toString();
        if (!id) {
          continue;
        }
        const orderItem = stage.order_item;
        items.set(id, {
          id,
          deleted: Boolean(orderItem?.deleted_at),
          name: lineDisplayName(orderItem?.item?.name, orderItem?.variant),
          orderNumber,
          context,
          batchKey: batch.batchKey,
          isAddonBatch: isAddon,
        });
      }
    }
  }

  return { batches, items };
};

export const useKitchenOrderAnnouncements = (
  orders: KitchenOrder[],
  kitchenId?: string,
  /** True after the first load for the current kitchen has finished. */
  hydrated = false
) => {
  const { t, i18n } = useTranslation('kitchen');
  const knownBatchesRef = useRef<Map<string, BatchSnapshot>>(new Map());
  const knownItemsRef = useRef<Map<string, ItemSnapshot>>(new Map());
  const pendingRecallsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const kitchenIdRef = useRef<string | undefined>(undefined);
  const staleHydrationRef = useRef(false);
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [highlightedBatchKeys, setHighlightedBatchKeys] = useState<Set<string>>(new Set());

  /** Mark a batch so its return to the board is announced as a recall, not a new order. */
  const markBatchRecalled = useCallback((batchKey: string) => {
    pendingRecallsRef.current.add(batchKey);
  }, []);

  const speak = useCallback((text: string) => {
    playReadyChime();
    // Let the loud chime finish before speech so both cut through the kitchen.
    window.setTimeout(() => {
      speakOrderReady(text, i18n.language);
    }, 900);
  }, [i18n.language]);

  const highlightBatch = (batchKey: string) => {
    setHighlightedBatchKeys((prev) => {
      const next = new Set(prev);
      next.add(batchKey);
      return next;
    });

    const existingTimer = highlightTimersRef.current.get(batchKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      setHighlightedBatchKeys((prev) => {
        const next = new Set(prev);
        next.delete(batchKey);
        return next;
      });
      highlightTimersRef.current.delete(batchKey);
    }, HIGHLIGHT_MS);

    highlightTimersRef.current.set(batchKey, timer);
  };

  useEffect(() => {
    const currentKitchenId = kitchenId?.toString();
    if (kitchenIdRef.current !== currentKitchenId) {
      kitchenIdRef.current = currentKitchenId;
      initializedRef.current = false;
      knownBatchesRef.current = new Map();
      knownItemsRef.current = new Map();
      for (const timer of highlightTimersRef.current.values()) {
        clearTimeout(timer);
      }
      highlightTimersRef.current.clear();
      setHighlightedBatchKeys(new Set());
      // `hydrated` still describes the station just left: wait for it to drop, or that
      // station's orders become the baseline and every order here is announced as new.
      staleHydrationRef.current = hydrated;
    }

    if (!hydrated) {
      staleHydrationRef.current = false;
      return;
    }

    if (!currentKitchenId || staleHydrationRef.current) {
      return;
    }

    const { batches, items } = snapshotFromOrders(orders, {
      room: t('labels.room'),
      table: t('labels.table'),
    });

    if (!initializedRef.current) {
      initializedRef.current = true;
      knownBatchesRef.current = batches;
      knownItemsRef.current = items;
      return;
    }

    const prevBatches = knownBatchesRef.current;
    const prevItems = knownItemsRef.current;

    // New batches (order / addon fires) — or a completed ticket recalled to the board.
    for (const [batchKey, batch] of batches) {
      if (prevBatches.has(batchKey)) {
        continue;
      }

      if (pendingRecallsRef.current.has(batchKey)) {
        pendingRecallsRef.current.delete(batchKey);
        speak(
          t('announcements.recalled', {
            context: batch.context,
            number: batch.orderNumber,
          })
        );
        highlightBatch(batchKey);
        continue;
      }

      speak(
        batch.isAddon
          ? t('announcements.addon', {
              context: batch.context,
              number: batch.orderNumber,
            })
          : t('announcements.newOrder', {
              context: batch.context,
              number: batch.orderNumber,
            })
      );
      highlightBatch(batchKey);
    }

    // Item voids / cancellations while the line is still on the board.
    for (const [itemId, item] of items) {
      const prev = prevItems.get(itemId);
      if (!prev) {
        // New line on an already-known batch (treat as addon path if batch also new: batch already spoken).
        if (prevBatches.has(item.batchKey) && !item.deleted) {
          speak(
            t('announcements.itemAdded', {
              item: item.name || t('announcements.itemFallback'),
              context: item.context,
              number: item.orderNumber,
            })
          );
          highlightBatch(item.batchKey);
        }
        continue;
      }

      if (!prev.deleted && item.deleted) {
        speak(
          t('announcements.itemRemoved', {
            item: item.name || t('announcements.itemFallback'),
            context: item.context,
            number: item.orderNumber,
          })
        );
        highlightBatch(item.batchKey);
      }
    }

    // Item fully removed from the board with deleted flag (rare path).
    for (const [itemId, prev] of prevItems) {
      if (items.has(itemId)) {
        continue;
      }
      // Completed stages drop off without void — do not announce as deletion
      // unless the last known state was deleted, or the dish name suggests void.
      // Only announce when the previous snapshot already had deleted_at.
      if (prev.deleted) {
        // Already announced when deleted_at flipped.
        continue;
      }
    }

    knownBatchesRef.current = batches;
    knownItemsRef.current = items;
  }, [orders, kitchenId, hydrated, t, i18n.language, speak]);

  // Browsers only play sound after a gesture; any tap on the kitchen unlocks it.
  useEffect(() => {
    const unlock = () => {
      unlockSpeech();
      unlockReadyChime();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  useEffect(() => {
    // The timer map is never replaced: clear what it holds at unmount.
    const timers = highlightTimersRef.current;
    return () => {
      cancelOrderReadySpeech();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  return {
    highlightedBatchKeys,
    markBatchRecalled,
  };
};
