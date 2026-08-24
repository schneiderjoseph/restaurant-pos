import {type PropsWithChildren, useEffect} from 'react'
import {enterFullscreen, isFullscreenActive, lockLandscape} from '@/lib/fullscreen.ts'

/**
 * Force the POS into browser fullscreen on tablet.
 * Fullscreen API requires a user gesture — we enter on first pointer/key
 * and re-enter whenever the user interacts while not fullscreen.
 */
export function ForceFullscreenProvider({children}: PropsWithChildren) {
  useEffect(() => {
    let pending = false

    const ensure = () => {
      if (pending || isFullscreenActive()) {
        return
      }
      pending = true
      void enterFullscreen()
        .then((ok) => {
          if (ok) {
            void lockLandscape()
          }
        })
        .finally(() => {
          pending = false
        })
    }

    // Immediate attempt (works if launched from a gesture / installed app).
    ensure()

    const onInteract = () => ensure()
    document.addEventListener('pointerdown', onInteract, true)
    document.addEventListener('keydown', onInteract, true)
    document.addEventListener('touchstart', onInteract, {capture: true, passive: true})

    const onFsChange = () => {
      if (!isFullscreenActive()) {
        // Next tap will re-enter.
      } else {
        void lockLandscape()
      }
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)

    return () => {
      document.removeEventListener('pointerdown', onInteract, true)
      document.removeEventListener('keydown', onInteract, true)
      document.removeEventListener('touchstart', onInteract, true)
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener('webkitfullscreenchange', onFsChange)
    }
  }, [])

  return <>{children}</>
}
