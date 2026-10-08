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

describe('exact-grant order actions', () => {
  it('does not grant a discount or a tax change through the orders parent', () => {
    expect(userModulesGrant(['orders'], 'orders.apply_discount')).toBe(false);
    expect(userModulesGrant(['orders'], 'orders.apply_tax')).toBe(false);
    expect(moduleMatchCandidates('orders.apply_tax')).not.toContain('orders');
  });

  it('grants them when the role lists them', () => {
    expect(userModulesGrant(['orders', 'orders.apply_discount'], 'orders.apply_discount')).toBe(true);
  });

  it('still grants other order actions through the parent', () => {
    expect(userModulesGrant(['orders'], 'orders.print_final')).toBe(true);
  });
});
