"use client";

import { useEffect, useState } from "react";

import { useAuth } from "../lib/auth-context";
import { useSyncEngine } from "../lib/sync-context";

// Persistent, dismissible-per-session, never a blocking screen — offline is a first-class state
// here (composing/reading still works via the local store + outbox), not a degraded one
// (docs/UI_DIRECTION.md §7).
export function OfflineBanner() {
  const { status } = useAuth();
  const { connected } = useSyncEngine();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (connected) setDismissed(false);
  }, [connected]);

  if (status !== "authenticated" || connected || dismissed) return null;

  return (
    <div className="flex items-center justify-between gap-3 bg-accent-retention px-4 py-2 text-sm text-white" role="status">
      <span>You&rsquo;re offline. New messages will send once you&rsquo;re back online.</span>
      <button type="button" onClick={() => setDismissed(true)} className="shrink-0 underline" aria-label="Dismiss offline notice">
        Dismiss
      </button>
    </div>
  );
}
