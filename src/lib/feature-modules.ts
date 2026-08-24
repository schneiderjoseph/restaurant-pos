/**
 * Optional POS modules toggled at build time via VITE_MODULE_*.
 * Unset / empty → enabled (upstream default). Set false / 0 / no / off to hide.
 */

function envEnabled(raw: unknown, defaultEnabled = true): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultEnabled;
  }
  const value = String(raw).toLowerCase().trim();
  if (value === 'false' || value === '0' || value === 'no' || value === 'off') {
    return false;
  }
  if (value === 'true' || value === '1' || value === 'yes' || value === 'on') {
    return true;
  }
  return defaultEnabled;
}

export type FeatureModuleId =
  | 'hr'
  | 'delivery'
  | 'integrations'
  | 'accounting'
  | 'closing';

export function isHrModuleEnabled(): boolean {
  return envEnabled(import.meta.env.VITE_MODULE_HR);
}

export function isDeliveryModuleEnabled(): boolean {
  return envEnabled(import.meta.env.VITE_MODULE_DELIVERY);
}

export function isIntegrationsModuleEnabled(): boolean {
  return envEnabled(import.meta.env.VITE_MODULE_INTEGRATIONS);
}

export function isAccountingModuleEnabled(): boolean {
  return envEnabled(import.meta.env.VITE_MODULE_ACCOUNTING);
}

export function isClosingModuleEnabled(): boolean {
  return envEnabled(import.meta.env.VITE_MODULE_CLOSING);
}

export function isFeatureModuleEnabled(id: FeatureModuleId): boolean {
  switch (id) {
    case 'hr':
      return isHrModuleEnabled();
    case 'delivery':
      return isDeliveryModuleEnabled();
    case 'integrations':
      return isIntegrationsModuleEnabled();
    case 'accounting':
      return isAccountingModuleEnabled();
    case 'closing':
      return isClosingModuleEnabled();
    default:
      return true;
  }
}
