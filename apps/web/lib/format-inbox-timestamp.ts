// Inbox row timestamp (Phase 6 part 6, docs/UI_DIRECTION.md §5) — time for today, weekday name for
// the last week, a short date otherwise. Matches the coarse-buckets approach lib/format-last-seen.ts
// already uses rather than pulling in a relative-time library for one label.
export function formatInboxTimestamp(createdAt: Date): string {
  const now = new Date();
  const isToday = createdAt.toDateString() === now.toDateString();
  if (isToday) return createdAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const diffDays = Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000);
  if (diffDays < 7) return createdAt.toLocaleDateString([], { weekday: "short" });

  return createdAt.toLocaleDateString([], { month: "short", day: "numeric" });
}
