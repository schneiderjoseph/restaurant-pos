import { describe, expect, it } from 'vitest';
import {
  getPosMode,
  isAsiMode,
  isLoyverseMode,
  isExternalCatalogueMode,
  isResortFbEnabled,
  usesAsiPmsRooms,
} from '@/lib/pos-mode.ts';

describe('pos-mode', () => {
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
