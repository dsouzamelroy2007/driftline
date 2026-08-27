"use client";

import { countMessagesAfter, decodeTextPayload, listTimeline, type TimelineEntry } from "@driftline/local-store";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "../../components/avatar";
import { RequireAuth } from "../../components/auth-gate";
import { listConversations } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { conversationAvatarUrl, conversationDisplayName } from "../../lib/conversation-name";
import { useLocalStore } from "../../lib/local-store-context";
import { hasSeenOnboarding } from "../../lib/onboarding";
import { getLastReadId } from "../../lib/read-state";
import { linkClass, primaryButtonClass } from "../../lib/ui-classes";
import type { Conversation } from "../../lib/types";

const PREVIEW_POLL_MS = 4000;

interface Preview {
  text: string;
  createdAt: Date;
  unreadCount: number;
}

function previewTextFor(entry: TimelineEntry | undefined): string {
  if (!entry) return "No messages yet";
  if (entry.kind !== "message") return "System notice";
  if (entry.contentType !== "text/plain" || !entry.payload) return "Unsupported message";
  try {
    return decodeTextPayload(entry.payload);
  } catch {
    return "Unsupported message";
  }
}

function InboxContent() {
  const { authedCall, user } = useAuth();
  const { db } = useLocalStore();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, Preview>>({});

  useEffect(() => {
    if (!hasSeenOnboarding()) {
      router.replace("/onboarding");
    }
  }, [router]);

  useEffect(() => {
    authedCall((token) => listConversations(token))
      .then((result) => setConversations(result.conversations))
      .catch(() => setError("Couldn't load your conversations. Check your connection and try again."));
    // authedCall's identity changes whenever the access token refreshes; refetching on that is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!db || !conversations || conversations.length === 0) return;

    let cancelled = false;
    async function refreshPreviews() {
      const entries = await Promise.all(
        conversations!.map(async (conversation) => {
          const [latest] = await listTimeline(db!, conversation.id, { limit: 1 });
          const unreadCount = await countMessagesAfter(db!, conversation.id, getLastReadId(conversation.id));
          const preview: Preview = {
            text: previewTextFor(latest),
            createdAt: latest ? new Date(latest.createdAt) : new Date(conversation.createdAt),
            unreadCount,
          };
          return [conversation.id, preview] as const;
        }),
      );
      if (!cancelled) setPreviews(Object.fromEntries(entries));
    }

    void refreshPreviews();
    const interval = setInterval(() => void refreshPreviews(), PREVIEW_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [db, conversations]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-status-error">{error}</p>
        <button type="button" className={linkClass} onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (!conversations) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted" role="status">
        Loading conversations…
      </div>
    );
  }

  const sorted = [...conversations].sort((a, b) => {
    const aTime = previews[a.id]?.createdAt.getTime() ?? new Date(a.createdAt).getTime();
    const bTime = previews[b.id]?.createdAt.getTime() ?? new Date(b.createdAt).getTime();
    return bTime - aTime;
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="flex items-center justify-between border-b border-text-muted/20 px-4 py-3">
        <h1 className="text-lg font-semibold text-text-primary">Chats</h1>
        <div className="flex gap-3 text-sm">
          <Link href="/settings" className={linkClass}>
            Settings
          </Link>
          <Link href="/search" className={linkClass}>
            Search
          </Link>
          <Link href="/chat/new" className={linkClass}>
            New chat
          </Link>
        </div>
      </header>

      {sorted.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center text-text-muted">
          <p>No chats yet. New devices start empty by design — nothing is missing.</p>
          <Link href="/chat/new" className={primaryButtonClass + " max-w-xs text-center"}>
            Start a chat
          </Link>
        </div>
      ) : (
        <ul>
          {sorted.map((conversation) => {
            const preview = previews[conversation.id];
            return (
              <li key={conversation.id} className="border-b border-text-muted/10">
                <Link
                  href={`/chat/${conversation.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-bg-surface-raised motion-reduce:transition-none"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar
                      name={user ? conversationDisplayName(conversation, user.id) : "…"}
                      avatarUrl={user ? conversationAvatarUrl(conversation, user.id) : null}
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-primary">
                        {user ? conversationDisplayName(conversation, user.id) : "…"}
                      </p>
                      <p className="truncate text-sm text-text-muted">{preview?.text ?? "…"}</p>
                    </div>
                  </div>
                  {preview && preview.unreadCount > 0 && (
                    <span className="shrink-0 rounded-full bg-accent-primary px-2 py-0.5 text-xs font-medium text-white">
                      {preview.unreadCount > 99 ? "99+" : preview.unreadCount}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function InboxPage() {
  return (
    <RequireAuth>
      <InboxContent />
    </RequireAuth>
  );
}
