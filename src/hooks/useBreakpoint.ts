import {useMediaQuery} from 'react-responsive';
import {mediaQuery} from '@/lib/breakpoints.ts';

/** True only on phones (&lt; 640px). Tablets keep the classic POS layout. */
export function useIsNarrow(): boolean {
  return useMediaQuery({query: mediaQuery.narrow});
}

/** True when viewport is ≤480px. */
export function useIsPhone(): boolean {
  return useMediaQuery({query: mediaQuery.phone});
}

/** True when viewport is at least Tailwind `lg`. */
export function useIsLgUp(): boolean {
  return useMediaQuery({query: mediaQuery.lgUp});
}
