/**
 * OfflineModeBanner — persistent UI indicator shown when the SPA loses its
 * SurrealDB WebSocket connection while the user is logged in.
 */

import { useEffect, useState } from "react";
import { useDatabase } from "@/hooks/useDatabase.ts";
import { useOfflineQueue } from "@/hooks/useOfflineQueue.ts";
import { useTranslation } from "react-i18next";

export function OfflineModeBanner() {
  const { isEffectivelyConnected, hasSession } = useDatabase();
  const { pendingCount, failedCount, isReplaying, replayNow, clearFailed } = useOfflineQueue();
  const { t } = useTranslation(["common"]);
  const [showBanner, setShowBanner] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [wasConnected, setWasConnected] = useState(isEffectivelyConnected);

  const handleRetry = () => {
    window.dispatchEvent(new CustomEvent("posr-db-reconnect"));
    void replayNow();
  };

  useEffect(() => {
    if (!isEffectivelyConnected) {
      setShowBanner(true);
    } else if (wasConnected === false && isEffectivelyConnected) {
      const timer = setTimeout(() => setShowBanner(false), 2000);
      return () => clearTimeout(timer);
    }
    setWasConnected(isEffectivelyConnected);
  }, [isEffectivelyConnected, wasConnected]);

  if (!hasSession) return null;

  if (isEffectivelyConnected && pendingCount === 0 && failedCount === 0 && !showBanner) return null;

  // Refused writes: shown apart from "pending" (they are never replayed again).
  if (isEffectivelyConnected && pendingCount === 0 && !isReplaying && failedCount > 0 && !showBanner) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-[9999] bg-danger-600 text-white text-center py-1.5 text-sm font-medium shadow-md shadow-danger-600/30 flex items-center justify-center gap-3"
        data-testid="offline-banner-failed"
        role="alert"
      >
        <span>
          {t("common:offline.failedSync", {
            defaultValue: "{{count}} offline changes were refused by the database and not saved",
            count: failedCount,
          })}
        </span>
        {confirmClear ? (
          <>
            <button
              onClick={() => {
                setConfirmClear(false);
                void clearFailed();
              }}
              className="ml-2 px-3 py-0.5 bg-white text-danger-700 rounded text-xs font-bold hover:bg-danger-100 transition-colors"
              data-testid="offline-banner-clear-confirm"
            >
              {t("common:offline.clearFailedConfirm", { defaultValue: "Confirm discard" })}
            </button>
            <button
              onClick={() => setConfirmClear(false)}
              className="px-3 py-0.5 border border-white rounded text-xs font-bold"
            >
              {t("common:actions.cancel", { defaultValue: "Cancel" })}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmClear(true)}
            className="ml-2 px-3 py-0.5 bg-white text-danger-700 rounded text-xs font-bold hover:bg-danger-100 transition-colors"
            data-testid="offline-banner-clear"
          >
            {t("common:offline.clearFailed", { defaultValue: "Discard" })}
          </button>
        )}
      </div>
    );
  }

  if (isEffectivelyConnected && !showBanner && pendingCount === 0) return null;

  if (isEffectivelyConnected && (pendingCount > 0 || isReplaying)) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-[9999] bg-warning-500 text-white text-center py-1.5 text-sm font-medium shadow-md shadow-warning-600/30 flex items-center justify-center gap-3"
        data-testid="offline-banner-syncing"
        role="status"
        aria-live="polite"
      >
        <span className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
          {isReplaying
            ? t("common:offline.syncing", { defaultValue: "Syncing {{count}} offline changes…", count: pendingCount })
            : t("common:offline.pendingSync", { defaultValue: "{{count}} changes queued for sync", count: pendingCount })}
        </span>
        {!isReplaying && pendingCount > 0 && (
          <button
            onClick={() => void replayNow()}
            className="ml-2 px-3 py-0.5 bg-white text-warning-700 rounded text-xs font-bold hover:bg-warning-100 transition-colors"
          >
            {t("common:offline.syncNow", { defaultValue: "Sync now" })}
          </button>
        )}
      </div>
    );
  }

  if (isEffectivelyConnected && showBanner) {
    return (
      <div
        className="fixed top-0 left-0 right-0 z-[9999] bg-success-600 text-white text-center py-1.5 text-sm font-medium shadow-md shadow-success-600/30 transition-all"
        data-testid="offline-banner-reconnected"
      >
        {t("common:offline.reconnected", { defaultValue: "✓ Connection restored" })}
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] bg-danger-600 text-white text-center py-2 text-sm font-medium shadow-lg shadow-danger-600/30 flex items-center justify-center gap-3"
      data-testid="offline-banner-disconnected"
      role="alert"
      aria-live="assertive"
    >
      <span className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
        {pendingCount > 0
          ? t("common:offline.disconnectedWithQueue", {
              defaultValue: "⚠ Offline — {{count}} changes queued, will sync when reconnected",
              count: pendingCount,
            })
          : t("common:offline.disconnected", { defaultValue: "⚠ Offline — changes will sync when reconnected" })}
      </span>
      <button
        onClick={handleRetry}
        className="ml-2 px-3 py-0.5 bg-white text-danger-700 rounded text-xs font-bold hover:bg-danger-100 transition-colors"
        aria-label={t("common:offline.retry", { defaultValue: "Retry connection" })}
      >
        {t("common:offline.retry", { defaultValue: "Retry" })}
      </button>
    </div>
  );
}
