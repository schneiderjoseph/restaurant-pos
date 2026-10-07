import {type PropsWithChildren, useEffect} from 'react';

/**
 * Keeps `--visual-viewport-height` in sync with the browser visual viewport
 * (mobile URL bar / on-screen keyboard). Consumed by modal overlay CSS.
 */
export function VisualViewportProvider({children}: PropsWithChildren) {
  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      const height = window.visualViewport?.height ?? window.innerHeight;
      root.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`);
    };

    sync();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);

    return () => {
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return <>{children}</>;
}
