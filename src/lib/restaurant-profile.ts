import { Tables } from '@/api/db/tables.ts';
import {
  DEFAULT_RESTAURANT_PROFILE,
  RESTAURANT_PROFILE_KEY,
  type RestaurantProfile,
} from '@/api/model/restaurant_profile.ts';
import { detectMimeType } from '@/utils/files.ts';

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

function logoBytesToUint8Array(logo: unknown): Uint8Array | null {
  if (logo == null || logo === '') return null;
  if (logo instanceof Uint8Array) return logo.length ? logo : null;
  if (logo instanceof ArrayBuffer) return logo.byteLength ? new Uint8Array(logo) : null;
  if (ArrayBuffer.isView(logo)) {
    const view = logo as ArrayBufferView;
    return view.byteLength
      ? new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
      : null;
  }
  if (Array.isArray(logo)) {
    return logo.length ? new Uint8Array(logo) : null;
  }
  if (typeof logo === 'object') {
    const record = logo as { data?: unknown; type?: unknown };
    if (Array.isArray(record.data)) {
      return record.data.length ? new Uint8Array(record.data as number[]) : null;
    }
    const keys = Object.keys(record).filter((key) => /^\d+$/.test(key));
    if (keys.length > 0) {
      const bytes = keys
        .map((key) => Number(key))
        .sort((a, b) => a - b)
        .map((key) => Number((record as Record<string, number>)[String(key)]));
      return bytes.length ? new Uint8Array(bytes) : null;
    }
  }
  return null;
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
    const bytes = logoBytesToUint8Array(logo);
    if (!bytes?.byteLength) return null;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const mime = detectMimeType(buffer as ArrayBuffer, 'image/png');
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.subarray(i, Math.min(i + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(slice));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

function normalizeProfile(values?: Partial<RestaurantProfile> | null): RestaurantProfile {
  const rawLogo = values?.logo ?? null;
  const logoDataUrl = logoToDataUrl(rawLogo);
  return {
    name: String(values?.name ?? DEFAULT_RESTAURANT_PROFILE.name ?? '').trim(),
    address: String(values?.address ?? DEFAULT_RESTAURANT_PROFILE.address ?? '').trim(),
    phone: String(values?.phone ?? DEFAULT_RESTAURANT_PROFILE.phone ?? '').trim(),
    email: String(values?.email ?? DEFAULT_RESTAURANT_PROFILE.email ?? '').trim(),
    website: String(values?.website ?? DEFAULT_RESTAURANT_PROFILE.website ?? '').trim(),
    taxId: String(values?.taxId ?? DEFAULT_RESTAURANT_PROFILE.taxId ?? '').trim(),
    logo: logoDataUrl ?? (rawLogo == null || rawLogo === '' ? null : rawLogo),
  };
}

const PRINT_LOGO_MAX_EDGE_PX = 512;
const PRINT_LOGO_TARGET_BYTES = 250_000;

/** Downscale large logos before persisting so print payloads stay small. */
export async function optimizeLogoDataUrl(dataUrl: string | null): Promise<string | null> {
  if (!dataUrl || dataUrl.length <= PRINT_LOGO_TARGET_BYTES) return dataUrl;
  if (typeof document === 'undefined') return dataUrl;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, PRINT_LOGO_MAX_EDGE_PX / Math.max(img.width, img.height, 1));
      const width = Math.max(1, Math.round(img.width * scale));
      const height = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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
  cachedLogoDataUrl = logoDataUrl ?? cachedLogoDataUrl ?? null;
  notify();
  return {
    settingId: row?.id != null ? String(row.id) : undefined,
    profile,
    logoDataUrl: logoDataUrl ?? cachedLogoDataUrl ?? null,
  };
}

export async function saveRestaurantProfile(
  db: AnyDb,
  profile: RestaurantProfile,
  settingId?: string
): Promise<void> {
  const payload = normalizeProfile(profile);
  if (typeof payload.logo === 'string' && payload.logo.startsWith('data:')) {
    payload.logo = (await optimizeLogoDataUrl(payload.logo)) ?? payload.logo;
  }
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
export function restaurantProfileHeaderSections(
  profile: RestaurantProfile,
  logoDataUrl?: string | null
): Array<{
  enabled: boolean;
  type: 'text' | 'image';
  align: 'center';
  size: 'large' | 'normal';
  content: string;
}> {
  const sections: Array<{
    enabled: boolean;
    type: 'text' | 'image';
    align: 'center';
    size: 'large' | 'normal';
    content: string;
  }> = [];

  if (logoDataUrl) {
    sections.push({
      enabled: true,
      type: 'image',
      align: 'center',
      size: 'normal',
      content: logoDataUrl,
    });
  }

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
  if (profile.phone) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'normal',
      content: profile.phone,
    });
  }
  if (profile.email) {
    sections.push({
      enabled: true,
      type: 'text',
      align: 'center',
      size: 'normal',
      content: profile.email,
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
 * Merge restaurant branding into a print config.
 * When `forceProfileBranding` is true (bills), profile logo + header lines are always prepended.
 */
export function applyRestaurantProfileToPrintConfig(
  config: Record<string, unknown>,
  profile: RestaurantProfile,
  logoDataUrl: string | null,
  options?: { forceProfileBranding?: boolean }
): Record<string, unknown> {
  const force = options?.forceProfileBranding ?? false;
  const next = { ...config };
  const resolvedLogo = logoDataUrl || logoToDataUrl(profile.logo);
  const configLogoRaw = next.logo;
  const configLogo =
    typeof configLogoRaw === 'string'
      ? configLogoRaw.trim()
      : configLogoRaw != null && configLogoRaw !== ''
        ? configLogoRaw
        : '';
  const hasConfigLogo = Boolean(configLogo);

  if (resolvedLogo) {
    if (!hasConfigLogo || force) {
      next.logo = resolvedLogo;
      next.restaurantLogo = resolvedLogo;
    }
    next.showLogo = true;
  } else if (hasConfigLogo) {
    next.showLogo = next.showLogo !== false;
  }

  const generated = restaurantProfileHeaderSections(profile, force ? resolvedLogo : null);
  const headers = Array.isArray(next.headerSections) ? [...next.headerSections] : [];
  const hasTextHeader = headers.some((section) => {
    if (!section || typeof section !== 'object') return false;
    const s = section as { type?: string; content?: unknown; enabled?: boolean };
    return s.enabled !== false && s.type !== 'image' && String(s.content ?? '').trim().length > 0;
  });

  if (generated.length > 0) {
    if (force) {
      const profileTexts = new Set(
        generated.map((section) => String(section.content).trim().toLowerCase())
      );
      const custom = headers.filter((section) => {
        if (!section || typeof section !== 'object') return false;
        const s = section as { type?: string; content?: unknown; enabled?: boolean };
        if (s.enabled === false) return false;
        if (s.type === 'image') return true;
        const text = String(s.content ?? '').trim().toLowerCase();
        return text.length > 0 && !profileTexts.has(text);
      });
      next.headerSections = [...generated, ...custom];
    } else if (!hasTextHeader) {
      next.headerSections = [...generated, ...headers];
    }
  }

  if (profile.taxId) {
    next.vatNumber = next.vatNumber || profile.taxId;
    next.showVatNumber = true;
  }

  return next;
}
