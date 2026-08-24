import { describe, expect, it } from 'vitest';
import { moduleMatchCandidates, userModulesGrant } from '@/lib/access.rules.ts';

describe('moduleMatchCandidates', () => {
  it('includes parent group so settings grants settings.restaurant_profile', () => {
    expect(moduleMatchCandidates('settings.restaurant_profile')).toEqual(
      expect.arrayContaining(['settings.restaurant_profile', 'settings']),
    );
  });

  it('does not invent unrelated modules', () => {
    expect(moduleMatchCandidates('settings.restaurant_profile')).not.toContain('settings.printers');
  });
});

describe('userModulesGrant', () => {
  it('allows super-admin style roles that only have the settings group', () => {
    expect(userModulesGrant(['settings', 'settings.printers'], 'settings.restaurant_profile')).toBe(true);
  });

  it('allows the exact child module', () => {
    expect(userModulesGrant(['settings.restaurant_profile'], 'settings.restaurant_profile')).toBe(true);
  });

  it('denies unrelated settings children without the parent group', () => {
    expect(userModulesGrant(['settings.printers'], 'settings.restaurant_profile')).toBe(false);
  });
});
