import {useMediaQuery} from 'react-responsive';
import {mediaQuery} from '@/lib/breakpoints.ts';

/** True when viewport is below Tailwind `lg` (1024px) — phone / small portrait. */
export function useIsNarrow(): boolean {
  return useMediaQuery({query: mediaQuery.narrow});
}

/** True when viewport is ≤480px. */
export function useIsPhone(): boolean {
  return useMediaQuery({query: mediaQuery.phone});
}

/** True when viewport is at least Tailwind `lg` (tablet landscape / desktop POS). */
export function useIsLgUp(): boolean {
  return useMediaQuery({query: mediaQuery.lgUp});
}
