/** Browser fullscreen helpers for POS tablets (gesture-gated by the browser). */

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => Promise<void> | void
}

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void
  webkitRequestFullScreen?: () => Promise<void> | void
}

export function isFullscreenActive(): boolean {
  const doc = document as FsDocument
  return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement)
}

export async function enterFullscreen(
  target: HTMLElement = document.documentElement,
): Promise<boolean> {
  if (typeof document === 'undefined') {
    return false
  }
  if (isFullscreenActive()) {
    return true
  }

  const el = target as FsElement
  const request =
    el.requestFullscreen?.bind(el) ??
    el.webkitRequestFullscreen?.bind(el) ??
    el.webkitRequestFullScreen?.bind(el)

  if (!request) {
    return false
  }

  try {
    await Promise.resolve(request())
    return isFullscreenActive()
  } catch {
    // Browsers reject without a recent user gesture — caller retries on next tap.
    return false
  }
}

export async function exitFullscreen(): Promise<void> {
  const doc = document as FsDocument
  if (!isFullscreenActive()) {
    return
  }
  try {
    if (doc.exitFullscreen) {
      await doc.exitFullscreen()
      return
    }
    if (doc.webkitExitFullscreen) {
      await Promise.resolve(doc.webkitExitFullscreen())
    }
  } catch {
    // ignore
  }
}

/** Best-effort landscape lock (Android tablets / installed PWAs). */
export async function lockLandscape(): Promise<void> {
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (orientation: OrientationLockType) => Promise<void>
    }
    if (typeof orientation?.lock === 'function') {
      await orientation.lock('landscape')
    }
  } catch {
    // Desktop / unsupported — ignore
  }
}
