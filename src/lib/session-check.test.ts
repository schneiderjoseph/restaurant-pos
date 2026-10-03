import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkGatewaySession, isLocalLogoutInProgress } from '@/lib/session.ts';
import { getDeviceId } from '@/lib/device-id.ts';

const respond = (status: number, body: unknown = {}) =>
  vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('checkGatewaySession', () => {
  it('reads a live session as valid', async () => {
    vi.stubGlobal('fetch', respond(200, { ok: true }));
    expect(await checkGatewaySession('t')).toBe('valid');
  });

  it('reads a revoked session as replaced by another device', async () => {
    vi.stubGlobal('fetch', respond(401, { ok: false, code: 'session_revoked' }));
    expect(await checkGatewaySession('t')).toBe('replaced');
  });

  it('keeps an expired token apart from a replaced one', async () => {
    vi.stubGlobal('fetch', respond(401, { ok: false, error: 'Invalid or expired session token' }));
    expect(await checkGatewaySession('t')).toBe('invalid');
  });

  it('never signs out an offline tablet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await checkGatewaySession('t')).toBe('unknown');
    vi.stubGlobal('fetch', respond(502));
    expect(await checkGatewaySession('t')).toBe('unknown');
  });

  it('is not in a local logout before one starts', () => {
    expect(isLocalLogoutInProgress()).toBe(false);
  });
});

describe('getDeviceId', () => {
  it('stays the same for this browser', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    const first = getDeviceId();
    expect(first).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(getDeviceId()).toBe(first);
  });
});
