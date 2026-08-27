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

import { Avatar } from "../../../components/avatar";
import { RequireAuth } from "../../../components/auth-gate";
import { listConversations } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { conversationAvatarSeed, conversationAvatarUrl, conversationDisplayName } from "../../../lib/conversation-name";
import { uploadAttachment, validateAttachmentFile } from "../../../lib/attachment-upload";
import { formatLastSeen } from "../../../lib/format-last-seen";
import { useLocalStore } from "../../../lib/local-store-context";
import { setLastReadId } from "../../../lib/read-state";
import { useSyncEngine } from "../../../lib/sync-context";
import { noticeCopyFor } from "../../../lib/timeline-copy";
import { errorTextClass, inputClass, linkClass, primaryButtonCompactClass, secondaryButtonCompactClass } from "../../../lib/ui-classes";
import type { Conversation } from "../../../lib/types";

// Phase 6 part 5 (docs/ADR/0011-presence-and-receipts.md): live-only, never persisted — starts fresh
// every mount. "sent" isn't tracked explicitly; it's just the absence of an entry here.
type DeliveryStatus = "delivered" | "read";

const POLL_MS = 1500;
const PAGE_SIZE = 50;

// Mirrors apps/server's modules/media/media.service.ts allowlist (docs/ADR/0009-media-attachments.md).
const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// image/jpeg -> jpg, etc. — only ever called with an already-allowlisted contentType (IMAGE_CONTENT_TYPES).
function extensionForContentType(contentType: string): string {
  const subtype = contentType.split("/")[1] ?? "bin";
  return subtype === "jpeg" ? "jpg" : subtype;
}

// Reconstructs a displayable image from the locally-cached base64 bytes (either downloaded from R2
// at delivery time, or the sender's own file at compose time) via an object URL — never a giant
// inline data: URI. Revoked on unmount/change so the browser can reclaim the memory. The download
// link below reuses the same object URL — there was previously no way at all to save a received
// image to disk, only to view it inline.
function AttachmentImage({ contentType, base64 }: { contentType: string; base64: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let objectUrl: string | null = null;
    try {
      const binary = atob(base64);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      setUrl(objectUrl);
    } catch {
      setUrl(null);
    }
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [contentType, base64]);

  if (!url) return <p className="italic opacity-80">Image not available</p>;
  return (
    <div className="flex flex-col items-start gap-1">
      {/* An object: URL — next/image can't handle it, same reasoning as lib/qr-code.tsx's plain <img>. */}
      <img src={url} alt="Attachment" className="max-h-80 max-w-full rounded-control object-contain" />
      <a
        href={url}
        download={`attachment.${extensionForContentType(contentType)}`}
        className="text-xs text-inherit underline underline-offset-2 opacity-80 hover:opacity-100"
      >
        Download
      </a>
    </div>
  );
}

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

// Single check = sent (this device's own committed message, no event needed yet); double check,
// white/70 = delivered; double check, status-online green (deliberately not blue — user asked to
// avoid the exact WhatsApp look) = read. Plain Unicode rather than an icon dependency, matching this
// app's existing minimal-deps posture (docs/ADR/0011-presence-and-receipts.md).
function DeliveryTick({ status }: { status: DeliveryStatus | undefined }) {
  if (status === "read") return <span className="text-status-online">✓✓</span>;
  if (status === "delivered") return <span className="text-white/70">✓✓</span>;
  return <span className="text-white/70">✓</span>;
}

function MessageBubble({ entry, isSelf, status }: { entry: TimelineEntry; isSelf: boolean; status?: DeliveryStatus }) {
  const isImage = IMAGE_CONTENT_TYPES.includes(entry.contentType ?? "");
  return (
    <li className={`flex ${isSelf ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-bubble px-3 py-2 text-sm ${
          isSelf ? "bg-accent-primary text-white" : "bg-bg-surface-raised text-text-primary"
        }`}
      >
        {isImage ? (
          entry.attachmentPayload ? (
            <AttachmentImage contentType={entry.contentType!} base64={entry.attachmentPayload} />
          ) : (
            <p className="italic opacity-80">Image not available</p>
          )
        ) : (
          <p className="whitespace-pre-wrap break-words">
            {entry.contentType === "text/plain" && entry.payload ? safeDecode(entry.payload) : "Unsupported message"}
          </p>
        )}
        <p className={`mt-1 flex items-center justify-end gap-1 text-xs ${isSelf ? "text-white/70" : "text-text-muted"}`}>
          {new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          {isSelf && <DeliveryTick status={status} />}
        </p>
      </div>
    </li>
  );
}

function PendingBubble({ entry }: { entry: OutboxEntry }) {
  const isImage = IMAGE_CONTENT_TYPES.includes(entry.contentType);
  return (
    <li className="flex justify-end">
      <div className="max-w-[75%] rounded-bubble bg-accent-primary px-3 py-2 text-sm text-white opacity-60">
        {isImage && entry.attachmentPayload ? (
          <AttachmentImage contentType={entry.contentType} base64={entry.attachmentPayload} />
        ) : (
          <p className="whitespace-pre-wrap break-words">{isImage ? "Sending image…" : safeDecode(entry.payload)}</p>
        )}
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
  const { engine, connected, socket } = useSyncEngine();
  const router = useRouter();

  const [conversation, setConversation] = useState<Conversation | null | "not-found">(null);
  const [entriesById, setEntriesById] = useState<Map<number, TimelineEntry>>(new Map());
  const [outboxEntries, setOutboxEntries] = useState<OutboxEntry[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Phase 6 part 5 (docs/ADR/0011-presence-and-receipts.md) — live-only, reset on every mount.
  const [messageStatus, setMessageStatus] = useState<Map<string, DeliveryStatus>>(new Map());
  const [livePresence, setLivePresence] = useState<{ online: boolean; lastSeenAt: string | null } | null>(null);
  const scrollRef = useRef<HTMLUListElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAnnouncedIdRef = useRef(0);
  const lastReadSeqSentRef = useRef(0);

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
  const isDirect = conversation && conversation !== "not-found" && conversation.type === "direct";
  const otherMemberId =
    conversation && conversation !== "not-found" ? conversation.members.find((member) => member.userId !== user?.id)?.userId : undefined;

  // Mark-as-read + ARIA live announcement for the newest incoming message (docs/UI_DIRECTION.md §9),
  // and (Phase 6 part 5) tell the other side how far we've read, direct conversations only
  // (docs/ADR/0011-presence-and-receipts.md).
  useEffect(() => {
    if (sortedEntries.length === 0) return;
    const newest = sortedEntries[sortedEntries.length - 1]!;
    setLastReadId(conversationId, newest.id);

    if (newest.kind === "message" && newest.senderId !== user?.id && newest.id > lastAnnouncedIdRef.current) {
      lastAnnouncedIdRef.current = newest.id;
      setAnnouncement(newest.contentType === "text/plain" && newest.payload ? safeDecode(newest.payload) : "New message");
    }

    if (isDirect && socket && newest.kind === "message" && newest.seq != null && newest.seq > lastReadSeqSentRef.current) {
      lastReadSeqSentRef.current = newest.seq;
      socket.emit("conversation:read", { conversationId, throughSeq: newest.seq });
    }
  }, [sortedEntries, conversationId, user?.id, isDirect, socket]);

  // Live delivery/read ticks and presence (Phase 6 part 5) — none of this touches local-store; it's
  // ephemeral UI state that resets on every mount (docs/ADR/0011-presence-and-receipts.md).
  useEffect(() => {
    if (!socket) return;

    const handleDelivered = (payload: { envelopeId: string; conversationId: string }) => {
      if (payload.conversationId !== conversationId) return;
      setMessageStatus((current) => {
        if (current.get(payload.envelopeId) === "read") return current; // never downgrade
        const next = new Map(current);
        next.set(payload.envelopeId, "delivered");
        return next;
      });
    };

    const handleRead = (payload: { conversationId: string; throughSeq: number }) => {
      if (payload.conversationId !== conversationId) return;
      setMessageStatus((current) => {
        const next = new Map(current);
        for (const entry of entriesById.values()) {
          if (entry.kind === "message" && entry.senderId === user?.id && entry.envelopeId && entry.seq != null && entry.seq <= payload.throughSeq) {
            next.set(entry.envelopeId, "read");
          }
        }
        return next;
      });
    };

    const handlePresence = (payload: { userId: string; online: boolean; lastSeenAt: string | null }) => {
      if (payload.userId !== otherMemberId) return;
      setLivePresence({ online: payload.online, lastSeenAt: payload.lastSeenAt });
    };

    socket.on("envelope:delivered", handleDelivered);
    socket.on("conversation:read", handleRead);
    socket.on("presence:update", handlePresence);
    return () => {
      socket.off("envelope:delivered", handleDelivered);
      socket.off("conversation:read", handleRead);
      socket.off("presence:update", handlePresence);
    };
  }, [socket, conversationId, entriesById, user?.id, otherMemberId]);

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

  async function handleFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow re-selecting the same file later
    if (!file || !engine) return;

    const validationError = validateAttachmentFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    setUploadError(null);
    setUploading(true);
    try {
      const uploaded = await authedCall((token) => uploadAttachment(token, file));
      await engine.sendMessage(conversationId, uploaded.contentType, uploaded.descriptorPayload, uploaded.attachmentPayload);
      await refresh();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
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

  const otherMemberSnapshot = otherMemberId ? conversation?.members.find((m) => m.userId === otherMemberId) : undefined;
  const presence = livePresence ?? (otherMemberSnapshot ? { online: otherMemberSnapshot.online, lastSeenAt: otherMemberSnapshot.lastSeenAt } : null);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="flex items-center gap-3 border-b border-text-muted/20 px-4 py-3">
        <Link href="/chat" className={linkClass}>
          ←
        </Link>
        {conversation && user && (
          <Avatar
            name={conversationDisplayName(conversation, user.id)}
            avatarUrl={conversationAvatarUrl(conversation, user.id)}
            seed={conversationAvatarSeed(conversation, user.id)}
            online={Boolean(isDirect && presence?.online)}
            size="sm"
          />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-medium text-text-primary">
            {conversation && user ? conversationDisplayName(conversation, user.id) : "…"}
          </h1>
          {isDirect && presence && (
            <p className="truncate text-xs text-text-muted">{presence.online ? "Online" : formatLastSeen(presence.lastSeenAt)}</p>
          )}
        </div>
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
            <MessageBubble
              key={entry.id}
              entry={entry}
              isSelf={entry.senderId === user?.id}
              status={entry.envelopeId ? messageStatus.get(entry.envelopeId) : undefined}
            />
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

      <form onSubmit={handleSend} className="flex flex-col gap-2 border-t border-text-muted/20 p-3">
        {uploadError && (
          <p className={errorTextClass} role="alert">
            {uploadError}
          </p>
        )}
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(event) => void handleFileSelected(event)}
          />
          <button
            type="button"
            className={secondaryButtonCompactClass}
            onClick={() => fileInputRef.current?.click()}
            disabled={!engine || uploading}
          >
            {uploading ? "Uploading…" : "Attach"}
          </button>
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
        </div>
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
