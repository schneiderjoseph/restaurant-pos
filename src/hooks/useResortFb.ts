import { isResortFbEnabled } from '@/lib/pos-mode.ts';

/** Sync hook for Resort F&B — driven only by VITE_RESORT_FB (no Settings DB). */
export function useResortFb() {
  const enabled = isResortFbEnabled();
  return { enabled, loading: false };
}

export async function fetchResortFbEnabled(_db?: unknown): Promise<boolean> {
  return isResortFbEnabled();
}
