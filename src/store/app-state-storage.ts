import type { AppStateInterface } from '@/store/jotai.ts';

/** Same shape as jotai's SyncStorage (not exported by jotai/utils). */
export interface AppStateStorage {
  getItem: (key: string, initialValue: AppStateInterface) => AppStateInterface;
  setItem: (key: string, newValue: AppStateInterface) => void;
  removeItem: (key: string) => void;
  subscribe?: (
    key: string,
    callback: (value: AppStateInterface) => void,
    initialValue: AppStateInterface,
  ) => () => void;
}

/** The parts of app state that are never written to localStorage. */
type OrderGraph = Pick<AppStateInterface, 'cart' | 'orders' | 'order'>;

const pickOrderGraph = (value: AppStateInterface): OrderGraph => ({
  cart: value.cart,
  orders: value.orders,
  order: value.order,
});

/**
 * Keeps the in-progress order graph of this tab across atom remounts.
 *
 * Storage holds a slim copy without cart / orders / order. jotai re-reads storage
 * every time the atom is mounted again (Login screen after a lock → Menu), which
 * replaced the order being placed with the empty slim copy. The graph written last
 * is kept in memory and laid back over every value read from storage. A page reload
 * still starts empty, as before: this memory does not survive it.
 */
export function keepOrderGraphInMemory(inner: AppStateStorage): AppStateStorage {
  let live: OrderGraph | undefined;
  const withLive = (value: AppStateInterface): AppStateInterface =>
    live ? { ...value, ...live } : value;

  return {
    getItem: (key, initialValue) => withLive(inner.getItem(key, initialValue)),
    setItem: (key, newValue) => {
      live = pickOrderGraph(newValue);
      inner.setItem(key, newValue);
    },
    removeItem: (key) => {
      live = undefined;
      inner.removeItem(key);
    },
    subscribe: inner.subscribe
      ? (key, callback, initialValue) =>
          inner.subscribe!(key, (value) => callback(withLive(value)), initialValue)
      : undefined,
  };
}
