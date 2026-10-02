import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { atomWithStorage, createJSONStorage } from 'jotai/utils';
import type { AppStateInterface } from '@/store/jotai.ts';
import type { MenuItem } from '@/api/model/cart_item.ts';
import { keepOrderGraphInMemory } from '@/store/app-state-storage.ts';

const KEY = 'app-state';

const initial = { loggedIn: false, cart: [], orders: [], seats: [] } as unknown as AppStateInterface;
const soup = { id: 'dish:soup' } as unknown as MenuItem;
const beer = { id: 'dish:beer' } as unknown as MenuItem;

/** Writes a slim copy, like the app's localStorage wrapper: the order graph never reaches storage. */
function slimStringStorage() {
  const mem = new Map<string, string>();
  return {
    getItem: (key: string) => mem.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const parsed = JSON.parse(value) as AppStateInterface;
      mem.set(key, JSON.stringify({ ...parsed, cart: [], orders: [], order: undefined }));
    },
    removeItem: (key: string) => {
      mem.delete(key);
    },
  };
}

function appStateAtom(wrapped: boolean) {
  const strings = slimStringStorage();
  const json = createJSONStorage<AppStateInterface>(() => strings);
  return atomWithStorage<AppStateInterface>(
    KEY,
    initial,
    wrapped ? keepOrderGraphInMemory(json) : json,
    { getOnInit: true },
  );
}

/** Menu mounted → order placed → lock (Menu unmounts) → unlock (Menu mounts again). */
function lockAndUnlock(wrapped: boolean, beforeUnlock?: (set: (v: AppStateInterface) => void) => void) {
  const atom = appStateAtom(wrapped);
  const store = createStore();
  const unsubscribe = store.sub(atom, () => {});
  store.set(atom, { ...initial, cart: [soup, beer] });
  unsubscribe();
  beforeUnlock?.((value) => store.set(atom, value));
  store.sub(atom, () => {});
  return store.get(atom);
}

describe('keepOrderGraphInMemory', () => {
  it('reproduces the bug without it: remounting reads the slim copy and drops the cart', () => {
    expect(lockAndUnlock(false).cart).toEqual([]);
  });

  it('keeps the order being placed across a lock and unlock', () => {
    const cart = lockAndUnlock(true).cart;
    expect(cart).toHaveLength(2);
    expect(cart[0]).toBe(soup);
  });

  it('still clears the cart when another user signs in (switch-user writes an empty cart)', () => {
    const state = lockAndUnlock(true, (set) => set({ ...initial, cart: [] }));
    expect(state.cart).toEqual([]);
  });

  it('never writes the order graph to storage', () => {
    const strings = slimStringStorage();
    const storage = keepOrderGraphInMemory(createJSONStorage<AppStateInterface>(() => strings));
    storage.setItem(KEY, { ...initial, cart: [soup] });
    expect(JSON.parse(strings.getItem(KEY)!).cart).toEqual([]);
  });

  it('starts empty when nothing was set in this page (reload / new tab)', () => {
    const strings = slimStringStorage();
    strings.setItem(KEY, JSON.stringify({ ...initial, cart: [soup] }));
    const storage = keepOrderGraphInMemory(createJSONStorage<AppStateInterface>(() => strings));
    expect(storage.getItem(KEY, initial).cart).toEqual([]);
  });
});
