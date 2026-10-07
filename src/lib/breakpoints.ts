/** Breakpoints aligned with Tailwind defaults (sm/md/lg/xl). */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

/** Below this width we treat the device as "narrow" (phone / small portrait). */
export const NARROW_MAX = BREAKPOINTS.lg - 1;

/** Phone-ish portrait band used for denser dish grids and pad sizing. */
export const PHONE_MAX = 480;

export const mediaQuery = {
  smUp: `(min-width: ${BREAKPOINTS.sm}px)`,
  mdUp: `(min-width: ${BREAKPOINTS.md}px)`,
  lgUp: `(min-width: ${BREAKPOINTS.lg}px)`,
  xlUp: `(min-width: ${BREAKPOINTS.xl}px)`,
  narrow: `(max-width: ${NARROW_MAX}px)`,
  phone: `(max-width: ${PHONE_MAX}px)`,
} as const;

export function isNarrowViewport(width = typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.lg): boolean {
  return width <= NARROW_MAX;
}

export function isPhoneViewport(width = typeof window !== 'undefined' ? window.innerWidth : BREAKPOINTS.lg): boolean {
  return width <= PHONE_MAX;
}
