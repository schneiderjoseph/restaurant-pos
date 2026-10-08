/** Breakpoints aligned with Tailwind defaults (sm/md/lg/xl). */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/**
 * Phone-only band for stacked POS layouts (cart sheet, drawer nav, payment stack).
 * Tablets (≥640 CSS px, including iPad portrait/landscape) keep the classic POS chrome.
 */
export const NARROW_MAX = BREAKPOINTS.sm - 1;

/** Denser dish grids / pad sizing on very small phones. */
export const PHONE_MAX = 480;

export const mediaQuery = {
  smUp: `(min-width: ${BREAKPOINTS.sm}px)`,
  mdUp: `(min-width: ${BREAKPOINTS.md}px)`,
  lgUp: `(min-width: ${BREAKPOINTS.lg}px)`,
  xlUp: `(min-width: ${BREAKPOINTS.xl}px)`,
  narrow: `(max-width: ${NARROW_MAX}px)`,
  phone: `(max-width: ${PHONE_MAX}px)`,
} as const;

export function isNarrowViewport(width = typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.sm): boolean {
  return width <= NARROW_MAX;
}

export function isPhoneViewport(width = typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.sm): boolean {
  return width <= PHONE_MAX;
}
