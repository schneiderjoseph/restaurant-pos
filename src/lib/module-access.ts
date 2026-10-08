import {
  ACCOUNTS,
  ADMIN,
  CLOSING,
  DELIVERY,
  INTEGRATIONS,
  KITCHEN,
  MENU,
  ORDER_DISPLAY,
  ORDERS,
  REPORTS,
  SETTINGS,
  SUMMARY,
  TIP_DISTRIBUTION,
} from '@/routes/posr.ts';
import type { FeatureModuleId } from '@/lib/feature-modules.ts';
import { userModulesGrant } from '@/lib/access.rules.ts';

/** Feature-flag gates used by the sidebar (build-time VITE_MODULE_*). */
export type ModuleAccessFeatureFlags = {
  delivery: boolean;
  integrations: boolean;
  accounting: boolean;
  closing: boolean;
};

export type SidebarNavEntry = {
  link: string;
  /** Permission id checked with userModulesGrant (sidebar `role`). */
  role: string;
  /** Optional build-time feature module gate. */
  featureModule?: FeatureModuleId;
};

/**
 * Ordered top-level pages shared by the sidebar and the route guard.
 * Settings (wrench) is intentionally omitted — it is a separate control.
 */
export const SIDEBAR_NAV_ENTRIES: readonly SidebarNavEntry[] = [
  { link: MENU, role: 'menu' },
  { link: ORDERS, role: 'orders' },
  { link: SUMMARY, role: 'summary' },
  { link: KITCHEN, role: 'kitchen' },
  { link: ORDER_DISPLAY, role: 'order_display' },
  { link: DELIVERY, role: 'delivery', featureModule: 'delivery' },
  { link: CLOSING, role: 'closing', featureModule: 'closing' },
  { link: ADMIN, role: 'admin' },
  { link: REPORTS, role: 'reports' },
  { link: TIP_DISTRIBUTION, role: 'tips' },
  { link: ACCOUNTS, role: 'accounts', featureModule: 'accounting' },
  { link: INTEGRATIONS, role: 'integrations', featureModule: 'integrations' },
];

const FEATURE_FLAG_KEY: Record<FeatureModuleId, keyof ModuleAccessFeatureFlags> = {
  delivery: 'delivery',
  integrations: 'integrations',
  accounting: 'accounting',
  closing: 'closing',
};

/** True when the entry's optional feature flag is on (or it has none). */
export const isSidebarEntryFeatureEnabled = (
  entry: SidebarNavEntry,
  flags: ModuleAccessFeatureFlags,
): boolean => {
  if (!entry.featureModule) return true;
  return flags[FEATURE_FLAG_KEY[entry.featureModule]];
};

/**
 * Permission id for a pathname, or `null` when the route is not module-guarded
 * or is unknown.
 */
export const getRoutePermission = (pathname: string): string | null => {
  const path = pathname.split('?')[0] || pathname;

  if (path === MENU || path.startsWith(`${MENU}/`)) return 'menu';
  if (path === ORDERS || path.startsWith(`${ORDERS}/`)) return 'orders';
  if (path === SUMMARY || path.startsWith(`${SUMMARY}/`)) return 'summary';
  if (path === KITCHEN || path.startsWith(`${KITCHEN}/`)) return 'kitchen';
  if (path === ORDER_DISPLAY || path.startsWith(`${ORDER_DISPLAY}/`)) return 'order_display';
  if (path === DELIVERY || path.startsWith(`${DELIVERY}/`)) return 'delivery';
  if (path === CLOSING || path.startsWith(`${CLOSING}/`)) return 'closing';
  if (path === ADMIN || path.startsWith(`${ADMIN}/`)) return 'admin';
  if (path === REPORTS || path.startsWith(`${REPORTS}/`)) return 'reports';
  if (path === TIP_DISTRIBUTION || path.startsWith(`${TIP_DISTRIBUTION}/`)) return 'tips';
  if (path === ACCOUNTS || path.startsWith(`${ACCOUNTS}/`)) return 'accounts';
  if (path === INTEGRATIONS || path.startsWith(`${INTEGRATIONS}/`)) return 'integrations';
  if (path === SETTINGS || path.startsWith(`${SETTINGS}/`)) return 'settings';

  return null;
};

/** First sidebar page the user can open, respecting feature flags. */
export const getFirstAllowedPath = (
  modules: string[],
  flags: ModuleAccessFeatureFlags,
  can: (moduleId: string) => boolean = (m) => userModulesGrant(modules, m),
): string | null => {
  for (const entry of SIDEBAR_NAV_ENTRIES) {
    if (!isSidebarEntryFeatureEnabled(entry, flags)) continue;
    if (can(entry.role)) return entry.link;
  }
  return null;
};

/**
 * Whether the current route may stay open for this user.
 * Unguarded routes (unknown) always pass.
 * When `ready` is false the caller must not redirect — this helper assumes ready.
 */
export const canAccessPath = (
  pathname: string,
  modules: string[],
  flags: ModuleAccessFeatureFlags,
  can: (moduleId: string) => boolean = (m) => userModulesGrant(modules, m),
): boolean => {
  const permission = getRoutePermission(pathname);
  if (permission == null) return true;

  const entry = SIDEBAR_NAV_ENTRIES.find((e) => e.role === permission);
  if (entry && !isSidebarEntryFeatureEnabled(entry, flags)) {
    return false;
  }

  return can(permission);
};

/** Keep `selected` if still visible; otherwise the first visible key (or null). */
export const resolveVisibleSelection = <T extends string>(
  selected: T | null | undefined,
  visibleKeys: readonly T[],
): T | null => {
  if (visibleKeys.length === 0) return null;
  if (selected != null && visibleKeys.includes(selected)) return selected;
  return visibleKeys[0] ?? null;
};

/** Filter ordered tab keys by permission grant. */
export const filterKeysByModuleAccess = <T extends string>(
  keys: readonly T[],
  tabModules: Record<T, string>,
  can: (moduleId: string) => boolean,
): T[] => keys.filter((key) => can(tabModules[key]));

/** In-service actions a manager approves on the spot: shown even without the grant. */
export const MANAGER_APPROVAL_MODULES: ReadonlySet<string> = new Set([
  'orders.cancel',
  'orders.apply_tax',
  'orders.apply_discount',
  'orders.apply_coupon',
  'orders.apply_service_charges',
  'orders.change_extras',
  'orders.refund',
  'orders.open_cash_drawer',
  'orders.print_kot',
  'orders.print_final',
  'orders.print_temp',
  'orders.override_print_limit',
]);

/** Whether a control guarded by `module` (or `alternateModule`) is rendered. */
export const isActionVisible = (
  can: (moduleId: string) => boolean,
  module?: string,
  alternateModule?: string,
): boolean => {
  if (module == null || module === '') return true;
  if (can(module)) return true;
  if (alternateModule && can(alternateModule)) return true;
  if (MANAGER_APPROVAL_MODULES.has(module)) return true;
  return false;
};
