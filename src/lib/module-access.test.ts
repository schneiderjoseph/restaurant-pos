import { describe, expect, it } from 'vitest';
import {
  canAccessPath,
  filterKeysByModuleAccess,
  getFirstAllowedPath,
  getRoutePermission,
  isActionVisible,
  isSidebarEntryFeatureEnabled,
  MANAGER_APPROVAL_MODULES,
  resolveVisibleSelection,
  SIDEBAR_NAV_ENTRIES,
  type ModuleAccessFeatureFlags,
} from '@/lib/module-access.ts';
import {
  ADMIN,
  CLOCK,
  CLOSING,
  DELIVERY,
  HR,
  INVENTORY,
  MENU,
  ORDERS,
  REPORTS,
  SETTINGS,
  SUMMARY,
} from '@/routes/posr.ts';

const allFlagsOn: ModuleAccessFeatureFlags = {
  hr: true,
  delivery: true,
  integrations: true,
  accounting: true,
  closing: true,
};

const allFlagsOff: ModuleAccessFeatureFlags = {
  hr: false,
  delivery: false,
  integrations: false,
  accounting: false,
  closing: false,
};

describe('getRoutePermission', () => {
  it('maps top-level pages to their permission ids', () => {
    expect(getRoutePermission(MENU)).toBe('menu');
    expect(getRoutePermission(ORDERS)).toBe('orders');
    expect(getRoutePermission(SUMMARY)).toBe('summary');
    expect(getRoutePermission(ADMIN)).toBe('admin');
    expect(getRoutePermission(SETTINGS)).toBe('settings');
    expect(getRoutePermission(INVENTORY)).toBe('inventory');
    expect(getRoutePermission('/inventory/print/purchase/abc')).toBe('inventory');
    expect(getRoutePermission(REPORTS)).toBe('reports');
    expect(getRoutePermission(`${REPORTS}/sales-dashboard`)).toBe('reports');
  });

  it('does not guard CLOCK', () => {
    expect(getRoutePermission(CLOCK)).toBeNull();
  });
});

describe('getFirstAllowedPath', () => {
  it('returns the first sidebar entry the user can open', () => {
    expect(getFirstAllowedPath(['orders', 'admin'], allFlagsOn)).toBe(ORDERS);
    expect(getFirstAllowedPath(['admin'], allFlagsOn)).toBe(ADMIN);
  });

  it('skips feature-flagged entries that are disabled', () => {
    expect(getFirstAllowedPath(['delivery', 'hr', 'menu'], allFlagsOff)).toBe(MENU);
    expect(getFirstAllowedPath(['delivery', 'hr'], allFlagsOff)).toBeNull();
    expect(getFirstAllowedPath(['delivery'], { ...allFlagsOff, delivery: true })).toBe(DELIVERY);
  });

  it('returns null when nothing is allowed', () => {
    expect(getFirstAllowedPath([], allFlagsOn)).toBeNull();
    expect(getFirstAllowedPath(['settings'], allFlagsOn)).toBeNull();
  });

  it('respects parent-group grants via userModulesGrant', () => {
    expect(getFirstAllowedPath(['inventory'], allFlagsOn)).toBe(INVENTORY);
  });
});

describe('canAccessPath', () => {
  it('allows unguarded and granted routes', () => {
    expect(canAccessPath(CLOCK, [], allFlagsOn)).toBe(true);
    expect(canAccessPath(MENU, ['menu'], allFlagsOn)).toBe(true);
    expect(canAccessPath(`${REPORTS}/tax`, ['reports'], allFlagsOn)).toBe(true);
  });

  it('denies routes the user cannot open', () => {
    expect(canAccessPath(ADMIN, ['menu'], allFlagsOn)).toBe(false);
    expect(canAccessPath(SETTINGS, ['menu'], allFlagsOn)).toBe(false);
  });

  it('denies feature-flagged routes when the flag is off', () => {
    expect(canAccessPath(CLOSING, ['closing'], allFlagsOff)).toBe(false);
    expect(canAccessPath(HR, ['hr'], allFlagsOff)).toBe(false);
  });
});

describe('isSidebarEntryFeatureEnabled', () => {
  it('gates optional modules', () => {
    const delivery = SIDEBAR_NAV_ENTRIES.find((e) => e.link === DELIVERY)!;
    const menu = SIDEBAR_NAV_ENTRIES.find((e) => e.link === MENU)!;
    expect(isSidebarEntryFeatureEnabled(menu, allFlagsOff)).toBe(true);
    expect(isSidebarEntryFeatureEnabled(delivery, allFlagsOff)).toBe(false);
    expect(isSidebarEntryFeatureEnabled(delivery, allFlagsOn)).toBe(true);
  });
});

describe('filterKeysByModuleAccess / resolveVisibleSelection', () => {
  const tabs = {
    dishes: 'admin.dishes',
    menus: 'admin.menus',
    users: 'admin.users',
  } as const;

  it('keeps only granted tabs', () => {
    const can = (m: string) => m === 'admin.menus' || m === 'admin.users';
    expect(filterKeysByModuleAccess(['dishes', 'menus', 'users'] as const, tabs, can)).toEqual([
      'menus',
      'users',
    ]);
  });

  it('falls back to the first visible tab', () => {
    expect(resolveVisibleSelection('dishes', ['menus', 'users'] as const)).toBe('menus');
    expect(resolveVisibleSelection('users', ['menus', 'users'] as const)).toBe('users');
    expect(resolveVisibleSelection('dishes', [] as const)).toBeNull();
  });
});

describe('isActionVisible', () => {
  const can = (m: string) => m === 'admin.dishes.create' || m === 'admin.dishes.update';

  it('is visible when module is empty or undefined', () => {
    expect(isActionVisible(can)).toBe(true);
    expect(isActionVisible(can, undefined)).toBe(true);
    expect(isActionVisible(can, '')).toBe(true);
  });

  it('is visible when can(module) is true', () => {
    expect(isActionVisible(can, 'admin.dishes.create')).toBe(true);
  });

  it('is visible when alternateModule is granted', () => {
    expect(isActionVisible(can, 'admin.dishes.delete', 'admin.dishes.update')).toBe(true);
  });

  it('is visible for manager-approval modules even without the grant', () => {
    for (const moduleId of MANAGER_APPROVAL_MODULES) {
      expect(isActionVisible(() => false, moduleId)).toBe(true);
    }
  });

  it('is hidden when neither module nor alternate is granted and not manager-approval', () => {
    expect(isActionVisible(can, 'admin.dishes.delete')).toBe(false);
    expect(isActionVisible(can, 'admin.dishes.delete', 'admin.dishes.import')).toBe(false);
  });
});
