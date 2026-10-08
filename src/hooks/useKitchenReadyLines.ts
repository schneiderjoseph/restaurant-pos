import { useEffect, useRef, useState } from 'react';
import { useDB } from '@/api/db/db.ts';
import { Tables } from '@/api/db/tables.ts';
import { fetchKitchenReadiness } from '@/lib/kitchen-readiness.ts';
import { toRecordId } from '@/lib/utils.ts';

/**
 * Lines of an order being edited that the kitchen is done with ("order_item:id"), kept live:
 * a line turns ready in the cart as soon as the kitchen marks it.
 */
export const useKitchenReadyLines = (itemIds: string[]): Set<string> => {
  const db = useDB();
  const [ready, setReady] = useState<Set<string>>(new Set());
  const key = itemIds.join('|');
  const dbRef = useRef(db);
  dbRef.current = db;

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    if (ids.length === 0) {
      setReady(new Set());
      return;
    }

    let cancelled = false;
    const load = () => {
      fetchKitchenReadiness(dbRef.current, ids.map((id) => toRecordId(id)))
        .then(({ readyItems }) => {
          if (!cancelled) setReady(readyItems);
        })
        .catch((error) => console.error('Cart kitchen ready query failed', error));
    };
    load();

    let subscription: { kill: () => Promise<unknown> } | null = null;
    void dbRef.current.live(Tables.order_items_kitchen, () => load())
      .then((live) => {
        if (cancelled) {
          void live.kill().catch(() => undefined);
        } else {
          subscription = live;
        }
      })
      .catch((error) => console.error('Cart kitchen live query failed', error));

    return () => {
      cancelled = true;
      void subscription?.kill().catch(() => undefined);
    };
  }, [key]);

  return ready;
};
