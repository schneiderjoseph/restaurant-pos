import { describe, expect, it } from 'vitest';
import {
  RESUME_POINT_KEY,
  clearResumePoint,
  decideResume,
  readResumePoint,
  saveResumePoint,
} from '@/lib/session-resume.ts';
import { stripPersistedSession } from '@/lib/browser-session.ts';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

describe('resume point', () => {
  it('sends the same user back to the screen they were on', () => {
    const storage = memoryStorage();
    saveResumePoint('user:abc', '/orders?status=open', storage);
    expect(decideResume(readResumePoint(storage), 'abc')).toEqual({ kind: 'resume', path: '/orders?status=open' });
  });

  it('sends a different user to the menu with the previous order cleared', () => {
    const storage = memoryStorage();
    saveResumePoint('user:abc', '/orders', storage);
    expect(decideResume(readResumePoint(storage), 'user:xyz')).toEqual({ kind: 'switch-user' });
  });

  it('starts at the menu after a deliberate logout or with no previous session', () => {
    const storage = memoryStorage();
    saveResumePoint('abc', null, storage);
    expect(decideResume(readResumePoint(storage), 'abc')).toEqual({ kind: 'menu' });
    clearResumePoint(storage);
    expect(decideResume(readResumePoint(storage), 'abc')).toEqual({ kind: 'menu' });
  });

  it('never resumes onto the login screen or an off-site path', () => {
    for (const path of ['/', '//evil.example/x', 'https://evil.example', '']) {
      const storage = memoryStorage();
      saveResumePoint('abc', path, storage);
      expect(decideResume(readResumePoint(storage), 'abc')).toEqual({ kind: 'menu' });
    }
  });

  it('ignores a corrupt stored value', () => {
    const storage = memoryStorage({ [RESUME_POINT_KEY]: '{not json' });
    expect(readResumePoint(storage)).toBeNull();
  });
});

describe('stripPersistedSession', () => {
  it('signs the user out but keeps device preferences', () => {
    const storage = memoryStorage({
      'app-page': JSON.stringify({
        page: 'Menu',
        user: { id: 'user:abc' },
        locked: true,
        lockedBy: { id: 'user:abc' },
        language: 'fr',
        menuConfig: { showDishNumber: true },
      }),
      'app-state': JSON.stringify({
        loggedIn: false,
        table: { id: 'table:1' },
        order: { id: 'order:9' },
        customer: { id: 'customer:2' },
        persons: '4',
        ordersFilters: { users: [{ label: 'A', value: 'a' }] },
      }),
      [RESUME_POINT_KEY]: JSON.stringify({ userId: 'abc', path: '/orders' }),
    });

    stripPersistedSession(storage);

    const page = JSON.parse(storage.getItem('app-page')!);
    expect(page).toEqual({ page: 'Login', language: 'fr', menuConfig: { showDishNumber: true } });

    const state = JSON.parse(storage.getItem('app-state')!);
    expect(state.table).toBeUndefined();
    expect(state.order).toBeUndefined();
    expect(state.customer).toBeUndefined();
    expect(state.persons).toBe('1');
    expect(state.ordersFilters).toEqual({ users: [{ label: 'A', value: 'a' }] });

    expect(storage.getItem(RESUME_POINT_KEY)).toBeNull();
  });
});
