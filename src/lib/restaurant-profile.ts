import { Tables } from '@/api/db/tables.ts';
import {
  DEFAULT_RESTAURANT_PROFILE,
  RESTAURANT_PROFILE_KEY,
  type RestaurantProfile,
} from '@/api/model/restaurant_profile.ts';
import { detectMimeType, toArrayBuffer } from '@/utils/files.ts';

type AnyDb = {
  query: (sql: string, vars?: Record<string, unknown>) => Promise<unknown>;
  create?: (table: string, data: unknown) => Promise<unknown>;
  merge?: (id: unknown, data: unknown) => Promise<unknown>;
};

const listeners = new Set<() => void>();
let cachedProfile: RestaurantProfile | null = null;
let cachedLogoDataUrl: string | null | undefined;

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeRestaurantProfile(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRestaurantProfileSnapshot(): string {
  const p = cachedProfile ?? DEFAULT_RESTAURANT_PROFILE;
  return [
    p.name,
    p.address,
    p.phone,
    p.email,
    p.website,
    p.taxId,
    cachedLogoDataUrl ?? '',
  ].join('|');
}

export function getCachedRestaurantProfile(): RestaurantProfile {
  return cachedProfile ?? { ...DEFAULT_RESTAURANT_PROFILE };
}

export function getCachedRestaurantLogoDataUrl(): string | null {
  return cachedLogoDataUrl ?? null;
}

export function logoToDataUrl(logo: unknown): string | null {
  if (logo == null || logo === '') return null;
  if (typeof logo === 'string') {
    const trimmed = logo.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('data:')) return trimmed;
    return `data:image/png;base64,${trimmed}`;
  }

  try {
    let bytes: Uint8Array;
    if (logo instanceof ArrayBuffer) bytes = new Uint8Array(logo);
    else if (logo instanceof Uint8Array) bytes = logo;
    else if (Array.isArray(logo)) bytes = new Uint8Array(logo);
    else bytes = new Uint8Array(toArrayBuffer(logo as ArrayBuffer | Uint8Array | string));
    if (!bytes.byteLength) return null;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const mime = detectMimeType(buffer as ArrayBuffer, 'image/png');
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function normalizeProfile(values?: Partial<RestaurantProfile> | null): RestaurantProfile {
  return {
    name: String(values?.name ?? DEFAULT_RESTAURANT_PROFILE.name ?? '').trim(),
    address: String(values?.address ?? DEFAULT_RESTAURANT_PROFILE.address ?? '').trim(),
    phone: String(values?.phone ?? DEFAULT_RESTAURANT_PROFILE.phone ?? '').trim(),
    email: String(values?.email ?? DEFAULT_RESTAURANT_PROFILE.email ?? '').trim(),
    website: String(values?.website ?? DEFAULT_RESTAURANT_PROFILE.website ?? '').trim(),
    taxId: String(values?.taxId ?? DEFAULT_RESTAURANT_PROFILE.taxId ?? '').trim(),
    logo: values?.logo ?? null,
  };
}

export async function fetchRestaurantProfile(db: AnyDb): Promise<{
  settingId?: string;
  profile: RestaurantProfile;
  logoDataUrl: string | null;
}> {
  const [rows] = await db.query(
    `SELECT * FROM ${Tables.settings} WHERE key = $key AND is_global = true LIMIT 1`,
    { key: RESTAURANT_PROFILE_KEY }
  );
  const row = (Array.isArray(rows) ? rows[0] : undefined) as
    | { id?: unknown; values?: Partial<RestaurantProfile> }
    | undefined;
  const profile = normalizeProfile(row?.values);
  const logoDataUrl = logoToDataUrl(profile.logo);
  cachedProfile = profile;
  cachedLogoDataUrl = logoDataUrl;
  notify();
  return {
    settingId: row?.id != null ? String(row.id) : undefined,
    profile,
    logoDataUrl,
  };
}

export async function saveRestaurantProfile(
  db: AnyDb,
  profile: RestaurantProfile,
  settingId?: string
): Promise<void> {
  const payload = normalizeProfile(profile);
  if (settingId) {
    await db.merge?.(settingId, { values: payload });
  } else {
    await db.create?.(Tables.settings, {
      key: RESTAURANT_PROFILE_KEY,
      is_global: true,
      values: payload,
    });
  }
  cachedProfile = payload;
  cachedLogoDataUrl = logoToDataUrl(payload.logo);
  notify();
}

/** Build default receipt header lines from the restaurant profile. */
export function restaurantProfileHeaderSections(profile: RestaurantProfile): Array<{
  enabled: boolean;
  type: 'text';
  align: 'center';
  size: 'large' | 'normal';
  content: string;
}> {
  const sections: Array<{
    enabled: boolean;
    type: 'text';
    align: 'center';
    size: 'large' | 'normal';
    content: string;
  }> = [];

  if (profile.name) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'large',
      content: profile.name,
    });
  }
  if (profile.address) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'normal',
      content: profile.address,
    });
  }
  const contact = [profile.phone, profile.email].filter(Boolean).join(' · ');
  if (contact) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'normal',
      content: contact,
    });
  }
  if (profile.website) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'normal',
      content: profile.website,
    });
  }
  if (profile.taxId) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'normal',
      content: profile.taxId,
    });
  }
  return sections;
}

/**
 * Merge restaurant branding into a print config when the template has no logo / headers.
 */
export function applyRestaurantProfileToPrintConfig(
  config: Record<string, unknown>,
  profile: RestaurantProfile,
  logoDataUrl: string | null
): Record<string, unknown> {
  const next = { ...config };
  const existingLogo = typeof next.logo === 'string' ? next.logo.trim() : next.logo;
  if (!existingLogo && logoDataUrl) {
    next.logo = logoDataUrl;
    if (next.showLogo !== false) next.showLogo = true;
  }

  const headers = Array.isArray(next.headerSections) ? next.headerSections : [];
  const hasTextHeader = headers.some((section) => {
    if (!section || typeof section !== 'object') return false;
    const s = section as { type?: string; content?: unknown; enabled?: boolean };
    return s.enabled !== false && s.type !== 'image' && String(s.content ?? '').trim().length > 0;
  });
  if (!hasTextHeader) {
    const generated = restaurantProfileHeaderSections(profile);
    if (generated.length > 0) {
      next.headerSections = [...generated, ...headers];
    }
  }

  if (!next.vatNumber && profile.taxId) {
    next.vatNumber = profile.taxId;
  }

  return next;
}
