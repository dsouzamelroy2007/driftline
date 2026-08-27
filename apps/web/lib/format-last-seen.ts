// A few coarse buckets rather than a full relative-time library (docs/ADR/0011-presence-and-receipts.md) —
// consistent with this app's existing minimal-deps posture (see lib/ui-classes.ts's own comment).
export function formatLastSeen(lastSeenAt: string | null): string {
  if (!lastSeenAt) return "Offline";

  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);

  if (diffMinutes < 1) return "Last seen just now";
  if (diffMinutes < 60) return `Last seen ${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `Last seen ${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `Last seen ${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return `Last seen on ${new Date(lastSeenAt).toLocaleDateString()}`;
}
