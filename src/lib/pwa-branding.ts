/**
 * PWA / favicon branding.
 *
 * Priority (highest first):
 *  1. Restaurant profile logo (DB → localStorage) — updates when the client changes logo
 *  2. Per-install files in /branding/ (gitignored)
 *  3. Committed defaults in /icons/
 */

const MANIFEST_LINK_ID = 'posr-manifest';
const ICON_LINK_ID = 'posr-favicon';
const APPLE_ICON_LINK_ID = 'posr-apple-touch-icon';

const DEFAULT_ICON_192 = '/icons/icon-192.png';
const DEFAULT_ICON_512 = '/icons/icon-512.png';
const DEFAULT_APPLE = '/icons/apple-touch-icon.png';
const BRANDING_ICON_192 = '/branding/icon-192.png';
const BRANDING_ICON_512 = '/branding/icon-512.png';
const BRANDING_APPLE = '/branding/apple-touch-icon.png';

let manifestObjectUrl: string | null = null;
let lastAppliedKey = '';

function appNameFromProfile(name?: string | null): string {
  const fromProfile = name?.trim();
  if (fromProfile) return fromProfile;
  const fromEnv = (import.meta.env.VITE_RESTAURANT_NAME as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  return 'Restaurant POS';
}

function upsertLink(id: string, rel: string, attrs: Record<string, string>): void {
  let el = document.getElementById(id) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.id = id;
    el.rel = rel;
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
}

/** Draw any logo onto a square white canvas (letterboxed). Works for any client logo. */
export async function logoToSquarePngDataUrl(
  logoSrc: string,
  size: number,
  paddingRatio = 0.1
): Promise<string | null> {
  if (typeof document === 'undefined') return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(null);
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      const pad = size * paddingRatio;
      const maxW = size - pad * 2;
      const maxH = size - pad * 2;
      const scale = Math.min(maxW / Math.max(img.width, 1), maxH / Math.max(img.height, 1));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const x = Math.round((size - w) / 2);
      const y = Math.round((size - h) / 2);
      ctx.drawImage(img, x, y, w, h);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = logoSrc;
  });
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    return res.ok;
  } catch {
    return false;
  }
}

async function resolveStaticIcons(): Promise<{
  icon192: string;
  icon512: string;
  apple: string;
}> {
  const hasBranding = await urlExists(BRANDING_ICON_192);
  if (hasBranding) {
    return {
      icon192: BRANDING_ICON_192,
      icon512: BRANDING_ICON_512,
      apple: BRANDING_APPLE,
    };
  }
  return {
    icon192: DEFAULT_ICON_192,
    icon512: DEFAULT_ICON_512,
    apple: DEFAULT_APPLE,
  };
}

function publishManifest(manifest: Record<string, unknown>): void {
  if (manifestObjectUrl) {
    URL.revokeObjectURL(manifestObjectUrl);
    manifestObjectUrl = null;
  }
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' });
  manifestObjectUrl = URL.createObjectURL(blob);
  upsertLink(MANIFEST_LINK_ID, 'manifest', { href: manifestObjectUrl });
}

export type PwaBrandingOptions = {
  /** Restaurant display name for the installed app. */
  name?: string | null;
  /** data: URL or path to the current restaurant logo. */
  logoSrc?: string | null;
};

/**
 * Apply favicon + apple-touch-icon + web manifest icons.
 * Safe to call repeatedly; no-ops when nothing changed.
 */
export async function applyPwaBranding(options: PwaBrandingOptions = {}): Promise<void> {
  if (typeof document === 'undefined') return;

  const name = appNameFromProfile(options.name);
  const logoSrc = options.logoSrc?.trim() || null;
  const key = `${name}|${logoSrc ?? ''}`;
  if (key === lastAppliedKey) return;

  let icon192: string;
  let icon512: string;
  let apple: string;

  if (logoSrc) {
    const [squared192, squared512] = await Promise.all([
      logoToSquarePngDataUrl(logoSrc, 192),
      logoToSquarePngDataUrl(logoSrc, 512),
    ]);
    if (squared192 && squared512) {
      icon192 = squared192;
      icon512 = squared512;
      apple = squared192;
    } else {
      const fallback = await resolveStaticIcons();
      icon192 = fallback.icon192;
      icon512 = fallback.icon512;
      apple = fallback.apple;
    }
  } else {
    const fallback = await resolveStaticIcons();
    icon192 = fallback.icon192;
    icon512 = fallback.icon512;
    apple = fallback.apple;
  }

  upsertLink(ICON_LINK_ID, 'icon', {
    type: 'image/png',
    href: icon192,
    sizes: '192x192',
  });
  upsertLink(APPLE_ICON_LINK_ID, 'apple-touch-icon', {
    href: apple,
    sizes: '180x180',
  });

  let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]') as HTMLMetaElement | null;
  if (!appleTitle) {
    appleTitle = document.createElement('meta');
    appleTitle.name = 'apple-mobile-web-app-title';
    document.head.appendChild(appleTitle);
  }
  appleTitle.content = name;

  publishManifest({
    name,
    short_name: name.length > 12 ? name.slice(0, 12) : name,
    description: `${name} POS`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#ffffff',
    theme_color: '#0084FF',
    icons: [
      { src: icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  });

  lastAppliedKey = key;
}
