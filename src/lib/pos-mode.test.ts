import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPosMode,
  isAsiMode,
  isLoyverseMode,
  isExternalCatalogueMode,
  isResortFbEnabled,
  usesAsiPmsRooms,
} from '@/lib/pos-mode.ts';

describe('pos-mode', () => {
  // The machine's .env (e.g. VITE_POS_MODE=asi) must not decide the defaults under test.
  beforeEach(() => {
    vi.stubEnv('VITE_POS_MODE', '');
    vi.stubEnv('VITE_RESORT_FB', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to native when unset', () => {
    expect(getPosMode()).toBe('native');
    expect(isAsiMode()).toBe(false);
    expect(isLoyverseMode()).toBe(false);
    expect(isExternalCatalogueMode()).toBe(false);
    expect(usesAsiPmsRooms()).toBe(false);
  });

  it('treats resort as off when unset', () => {
    expect(isResortFbEnabled()).toBe(false);
  });
});
