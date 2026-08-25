import type { TimelineEntry } from "@driftline/local-store";

export interface NoticeCopy {
  title: string;
  body: string;
  /** Whether to show the "import backup" / "link device" recovery actions (docs/UI_DIRECTION.md §8). */
  showRecoveryActions: boolean;
}

// Factual tone, always paired with recovery actions for anything that means missed history
// (docs/UI_DIRECTION.md §8) — these two flows (backup import, device linking) ship in Phase 6, so
// the buttons route to Settings with a "coming soon" note rather than doing nothing.
export function noticeCopyFor(entry: Pick<TimelineEntry, "kind" | "gapFromSeq" | "gapToSeq">): NoticeCopy {
  switch (entry.kind) {
    case "gap":
      return {
        title: "Some messages are missing",
        body:
          entry.gapFromSeq != null && entry.gapToSeq != null
            ? `Messages ${entry.gapFromSeq}–${entry.gapToSeq} in this chat were deleted from the server before this device could receive them (30-day retention).`
            : "Some messages in this chat were deleted from the server before this device could receive them (30-day retention).",
        showRecoveryActions: true,
      };
    case "dormancy_return":
      return {
        title: "Welcome back",
        body: "This device was inactive long enough that some messages may not have reached it. Check other devices for anything missing here.",
        showRecoveryActions: true,
      };
    case "history_start":
      return {
        title: "History starts here",
        body: "This is a new device — earlier messages in this chat live only on your other devices, if any.",
        showRecoveryActions: true,
      };
    case "message":
      throw new Error("noticeCopyFor is only for system-message timeline entry kinds, not 'message'");
  }
}
