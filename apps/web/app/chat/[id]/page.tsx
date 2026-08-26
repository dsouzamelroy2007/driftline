"use client";

import {
  decodeTextPayload,
  encodeTextPayload,
  listOutboxEntries,
  listTimeline,
  type OutboxEntry,
  type TimelineEntry,
} from "@driftline/local-store";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { RequireAuth } from "../../../components/auth-gate";
import { listConversations } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { conversationDisplayName } from "../../../lib/conversation-name";
import { useLocalStore } from "../../../lib/local-store-context";
import { setLastReadId } from "../../../lib/read-state";
import { useSyncEngine } from "../../../lib/sync-context";
import { noticeCopyFor } from "../../../lib/timeline-copy";
import { inputClass, linkClass, primaryButtonCompactClass } from "../../../lib/ui-classes";
import type { Conversation } from "../../../lib/types";

const POLL_MS = 1500;
const PAGE_SIZE = 50;

function GapOrSystemNotice({ entry }: { entry: TimelineEntry }) {
  const copy = noticeCopyFor(entry);
  return (
    <li className="mx-auto flex max-w-sm flex-col gap-2 rounded-bubble border border-accent-retention/40 bg-bg-surface-raised p-3 text-center text-sm">
      <p className="font-medium text-accent-retention">{copy.title}</p>
      <p className="text-text-muted">{copy.body}</p>
      {copy.showRecoveryActions && (
        <div className="flex justify-center gap-4 text-xs">
          <Link href="/settings/backup" className={linkClass}>
            Import backup
          </Link>
          <Link href="/settings/link-device" className={linkClass}>
            Link a device
          </Link>
        </div>
      )}
    </li>
  );
}

function MessageBubble({ entry, isSelf }: { entry: TimelineEntry; isSelf: boolean }) {
  const text = entry.contentType === "text/plain" && entry.payload ? safeDecode(entry.payload) : "Unsupported message";
  return (
    <li className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-bubble px-3 py-2 text-sm ${
          isSelf ? "bg-accent-primary text-white" : "bg-bg-surface-raised text-text-primary"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
        <p className={`mt-1 text-right text-xs ${isSelf ? "text-white/70" : "text-text-muted"}`}>
          {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </li>
  );
}

function PendingBubble({ entry }: { entry: OutboxEntry }) {
  const text = safeDecode(entry.payload);
  return (
    <li className="flex justify-end">
      <div className="max-w-[75%] rounded-bubble bg-accent-primary px-3 py-2 text-sm text-white opacity-60">
        <p className="whitespace-pre-wrap break-words">{text}</p>
        <p className="mt-1 text-right text-xs text-white/70">{entry.status === "failed" ? "Failed — will retry" : "Sending…"}</p>
      </div>
    </li>
  );
}

function safeDecode(payload: string): string {
  try {
    return decodeTextPayload(payload);
  } catch {
    return "Unsupported message";
  }
}

function ThreadContent() {
  const { id: conversationId } = useParams<{ id: string }>();
  const { authedCall, user } = useAuth();
  const { db } = useLocalStore();
  const { engine, connected } = useSyncEngine();
  const router = useRouter();

  const [conversation, setConversation] = useState<Conversation | null | "not-found">(null);
  const [entriesById, setEntriesById] = useState<Map<number, TimelineEntry>>(new Map());
  const [outboxEntries, setOutboxEntries] = useState<OutboxEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const scrollRef = useRef<HTMLUListElement>(null);
  const lastAnnouncedIdRef = useRef(0);

  useEffect(() => {
    authedCall((token) => listConversations(token))
      .then((result) => setConversation(result.conversations.find((c) => c.id === conversationId) ?? "not-found"))
      .catch(() => setConversation("not-found"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const refresh = useCallback(async () => {
    if (!db) return;
    const latest = await listTimeline(db, conversationId, { limit: PAGE_SIZE });
    setEntriesById((current) => {
      const next = new Map(current);
      for (const entry of latest) next.set(entry.id, entry);
      return next;
    });
    const pending = await listOutboxEntries(db);
    setOutboxEntries(pending.filter((entry) => entry.conversationId === conversationId));
  }, [db, conversationId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const sortedEntries = useMemo(() => [...entriesById.values()].sort((a, b) => a.id - b.id), [entriesById]);

  // Mark-as-read + ARIA live announcement for the newest incoming message (docs/UI_DIRECTION.md §9).
  useEffect(() => {
    if (sortedEntries.length === 0) return;
    const newest = sortedEntries[sortedEntries.length - 1]!;
    setLastReadId(conversationId, newest.id);

    if (newest.kind === "message" && newest.senderId !== user?.id && newest.id > lastAnnouncedIdRef.current) {
      lastAnnouncedIdRef.current = newest.id;
      setAnnouncement(newest.contentType === "text/plain" && newest.payload ? safeDecode(newest.payload) : "New message");
    }
  }, [sortedEntries, conversationId, user?.id]);

  async function loadOlder() {
    if (!db || sortedEntries.length === 0) return;
    const oldestId = sortedEntries[0]!.id;
    const older = await listTimeline(db, conversationId, { limit: PAGE_SIZE, beforeId: oldestId });
    if (older.length === 0) {
      setHasMore(false);
      return;
    }
    setEntriesById((current) => {
      const next = new Map(current);
      for (const entry of older) next.set(entry.id, entry);
      return next;
    });
  }

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !engine) return;
    setDraft("");
    setSending(true);
    try {
      await engine.sendMessage(conversationId, "text/plain", encodeTextPayload(text));
      await refresh();
    } finally {
      setSending(false);
    }
  }

  if (conversation === "not-found") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <p className="text-text-muted">This conversation isn&rsquo;t available.</p>
        <button type="button" className={linkClass} onClick={() => router.push("/chat")}>
          Back to chats
        </button>
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="flex items-center gap-3 border-b border-text-muted/20 px-4 py-3">
        <Link href="/chat" className={linkClass}>
          ←
        </Link>
        <h1 className="flex-1 truncate font-medium text-text-primary">
          {conversation && user ? conversationDisplayName(conversation, user.id) : "…"}
        </h1>
        {conversation && (
          <Link href={`/chat/${conversationId}/settings`} className={linkClass + " text-sm"}>
            Details
          </Link>
        )}
      </header>

      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>

      <ul ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {hasMore && sortedEntries.length > 0 && (
          <li className="text-center">
            <button type="button" className={linkClass + " text-sm"} onClick={loadOlder}>
              Load older messages
            </button>
          </li>
        )}
        {sortedEntries.length === 0 && outboxEntries.length === 0 && (
          <li className="flex flex-1 items-center justify-center py-12 text-center text-text-muted">
            No messages yet. Say hello.
          </li>
        )}
        {sortedEntries.map((entry) =>
          entry.kind === "message" ? (
            <MessageBubble key={entry.id} entry={entry} isSelf={entry.senderId === user?.id} />
          ) : (
            <GapOrSystemNotice key={entry.id} entry={entry} />
          ),
        )}
        {outboxEntries.map((entry) => (
          <PendingBubble key={entry.clientId} entry={entry} />
        ))}
      </ul>

      {!connected && (
        <p className="px-4 pb-1 text-xs text-text-muted" role="status">
          Offline — messages you send will queue and go out once you&rsquo;re back online.
        </p>
      )}

      <form onSubmit={handleSend} className="flex gap-2 border-t border-text-muted/20 p-3">
        <input
          className={inputClass + " min-w-0 flex-1"}
          placeholder="Message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={100_000}
          disabled={!engine}
        />
        <button type="submit" className={primaryButtonCompactClass} disabled={!draft.trim() || sending || !engine}>
          Send
        </button>
      </form>
    </main>
  );
}

export default function ThreadPage() {
  return (
    <RequireAuth>
      <ThreadContent />
    </RequireAuth>
  );
}
