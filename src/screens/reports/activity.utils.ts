import i18n from '@/lib/i18n.ts';

const tr = (key: string) => i18n.t(`reports:activity.${key}`);

export const detectBrowser = (userAgent?: string) => {
  if (!userAgent) return "-";
  const ua = userAgent.toLowerCase();

  if (ua.includes("edg/")) return tr('edge');
  if (ua.includes("opr/") || ua.includes("opera/")) return tr('opera');
  if (ua.includes("chrome/") && !ua.includes("edg/") && !ua.includes("opr/")) return tr('chrome');
  if (ua.includes("firefox/")) return tr('firefox');
  if (ua.includes("safari/") && !ua.includes("chrome/")) return tr('safari');
  return tr('unknownBrowser');
};

export const detectOS = (userAgent?: string) => {
  if (!userAgent) return "-";
  const ua = userAgent.toLowerCase();

  if (ua.includes("windows")) return tr('windows');
  if (ua.includes("android")) return tr('android');
  if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return tr('ios');
  if (ua.includes("mac os x") || ua.includes("macintosh")) return tr('macos');
  if (ua.includes("linux")) return tr('linux');
  return tr('unknownOs');
};

export const displayValue = (value?: unknown) => {
  if (value === undefined || value === null) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
