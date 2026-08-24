import { describe, expect, it } from 'vitest';
import { getPosMode, isAsiMode, isResortFbEnabled } from '@/lib/pos-mode.ts';

describe('pos-mode', () => {
  it('defaults to native when unset', () => {
    expect(getPosMode()).toBe('native');
    expect(isAsiMode()).toBe(false);
  });

  it('treats resort as off when unset', () => {
    expect(isResortFbEnabled()).toBe(false);
  });
});
