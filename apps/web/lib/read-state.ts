// Per-device "read up to" boundary for the Inbox unread badge (docs/UI_DIRECTION.md §2). Lives in
// localStorage, not @driftline/local-store's SQLite schema — it's a per-viewport UI concern, not
// sync/delivery state the sync engine or another device would ever need to see.
function key(conversationId: string): string {
  return `driftline.lastRead.${conversationId}`;
}

export function getLastReadId(conversationId: string): number {
  const raw = localStorage.getItem(key(conversationId));
  return raw ? Number(raw) : 0;
}

export function setLastReadId(conversationId: string, timelineEntryId: number): void {
  const current = getLastReadId(conversationId);
  if (timelineEntryId > current) {
    localStorage.setItem(key(conversationId), String(timelineEntryId));
  }
}
