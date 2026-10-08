/**
 * Auto-reload when nginx publishes a new /version.json buildId.
 *
 * Baseline is taken from version.json at boot (not from the baked VITE_BUILD_ID),
 * so scripts/reload-tablets.ps1 can bump the file without a reload loop.
 * VITE_BUILD_ID is only used once at boot to recover a stale cached bundle.
 */

const POLL_MS = 15_000
const IDLE_MS = 60_000
const TRIED_TTL_MS = 5 * 60_000
const STORAGE_PREFIX = 'posr-update-tried:'
const PENDING_CHECK_MS = 2_000

type Listener = (pending: boolean) => void

let baseline: string | null = null
let updatePending = false
let pendingRemoteId: string | null = null
let lastInteraction = Date.now()
let idleTimer: ReturnType<typeof setTimeout> | null = null
let started = false
const listeners = new Set<Listener>()

function notify(): void {
  for (const listener of listeners) listener(updatePending)
}

export function subscribeClientUpdate(listener: Listener): () => void {
  listeners.add(listener)
  listener(updatePending)
  return () => {
    listeners.delete(listener)
  }
}

export function isClientUpdatePending(): boolean {
  return updatePending
}

export function reloadForUpdate(): void {
  if (pendingRemoteId) markTried(pendingRemoteId)
  window.location.reload()
}

function markTried(buildId: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + buildId, String(Date.now()))
  } catch {
    // private mode / quota
  }
}

function wasTriedRecently(buildId: string): boolean {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + buildId)
    if (!raw) return false
    const at = Number(raw)
    if (!Number.isFinite(at)) return false
    if (Date.now() - at > TRIED_TTL_MS) {
      sessionStorage.removeItem(STORAGE_PREFIX + buildId)
      return false
    }
    return true
  } catch {
    return false
  }
}

async function fetchRemoteBuildId(): Promise<string | null> {
  try {
    const res = await fetch('/version.json', {cache: 'no-store'})
    if (!res.ok) return null
    const data = (await res.json()) as {buildId?: unknown}
    return typeof data.buildId === 'string' && data.buildId ? data.buildId : null
  } catch {
    return null
  }
}

function isQuietMoment(): boolean {
  if (document.hidden) return true
  // LOGIN / PIN screen (see src/routes/posr.ts)
  if (window.location.pathname === '/') return true
  return Date.now() - lastInteraction >= IDLE_MS
}

function tryAutoReload(remoteId: string): boolean {
  if (wasTriedRecently(remoteId)) return false
  if (!isQuietMoment()) return false
  markTried(remoteId)
  window.location.reload()
  return true
}

function scheduleIdleCheck(): void {
  if (idleTimer != null) clearTimeout(idleTimer)
  const remaining = Math.max(500, IDLE_MS - (Date.now() - lastInteraction))
  idleTimer = setTimeout(() => {
    if (!updatePending || !pendingRemoteId) return
    if (!tryAutoReload(pendingRemoteId)) scheduleIdleCheck()
  }, remaining)
}

function onUpdateDetected(remoteId: string): void {
  pendingRemoteId = remoteId
  if (!updatePending) {
    updatePending = true
    notify()
  }
  if (!tryAutoReload(remoteId)) scheduleIdleCheck()
}

async function checkForUpdate(): Promise<void> {
  const remote = await fetchRemoteBuildId()
  if (!remote) return

  if (baseline === null) {
    baseline = remote
    const baked = String(import.meta.env.VITE_BUILD_ID || '')
    if (baked && baked !== remote && !wasTriedRecently(remote)) {
      markTried(remote)
      window.location.reload()
    }
    return
  }

  if (remote !== baseline) onUpdateDetected(remote)
}

function onInteraction(): void {
  lastInteraction = Date.now()
  if (updatePending) scheduleIdleCheck()
}

export function startClientUpdateWatcher(): void {
  if (started || typeof window === 'undefined') return
  started = true

  for (const event of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(event, onInteraction, {passive: true})
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (updatePending && pendingRemoteId) tryAutoReload(pendingRemoteId)
      return
    }
    void checkForUpdate()
  })

  window.addEventListener('focus', () => {
    void checkForUpdate()
  })

  void checkForUpdate().then(() => {
    window.setInterval(() => {
      void checkForUpdate()
    }, POLL_MS)
  })

  window.setInterval(() => {
    if (!updatePending || !pendingRemoteId) return
    tryAutoReload(pendingRemoteId)
  }, PENDING_CHECK_MS)
}
