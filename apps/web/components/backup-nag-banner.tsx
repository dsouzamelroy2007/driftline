"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "../lib/auth-context";
import { getBackupNagState, snoozeBackupNag, type BackupNagState } from "../lib/backup-nag";

// docs/UI_DIRECTION.md §8's backup-nagging cadence — see lib/backup-nag.ts for the thresholds.
// hardDismissed is deliberately React state, not localStorage: once the 4-snooze cap is reached,
// "I understand the risk" only dismisses for this page load, not permanently — the point of the cap
// is that this can't be silenced indefinitely without ever backing up.
export function BackupNagBanner() {
  const { status, user } = useAuth();
  const [state, setState] = useState<BackupNagState | null>(null);
  const [hardDismissed, setHardDismissed] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !user) {
      setState(null);
      return;
    }
    setState(getBackupNagState(user.createdAt));
  }, [status, user]);

  if (!state || state.level === "none" || hardDismissed) return null;

  const escalated = state.level === "escalated";

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2 text-sm text-white ${escalated ? "bg-status-error" : "bg-accent-retention"}`}
      role="status"
    >
      <span>
        {escalated
          ? `It's been ${state.daysSinceBackup} days since your last backup — history on this device could be lost for good.`
          : `Last backup: ${state.daysSinceBackup} days ago.`}
      </span>
      <div className="flex shrink-0 items-center gap-4">
        <Link href="/settings/backup" className="underline">
          Back up now
        </Link>
        {state.canSnooze ? (
          <button
            type="button"
            onClick={() => {
              snoozeBackupNag();
              setState(user ? getBackupNagState(user.createdAt) : null);
            }}
            className="underline"
          >
            Snooze 7 days
          </button>
        ) : (
          <button type="button" onClick={() => setHardDismissed(true)} className="underline">
            I understand the risk
          </button>
        )}
      </div>
    </div>
  );
}
