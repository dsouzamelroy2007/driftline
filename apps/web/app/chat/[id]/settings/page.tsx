"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Avatar } from "../../../../components/avatar";
import { RequireAuth } from "../../../../components/auth-gate";
import { listConversations } from "../../../../lib/api-client";
import { useAuth } from "../../../../lib/auth-context";
import { conversationDisplayName } from "../../../../lib/conversation-name";
import { linkClass } from "../../../../lib/ui-classes";
import type { Conversation } from "../../../../lib/types";

function ConversationSettingsContent() {
  const { id: conversationId } = useParams<{ id: string }>();
  const { authedCall, user } = useAuth();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  // Mute/pin have no server support yet (MVP+, docs/ROADMAP.md) — local-only, per-browser for now.
  const [muted, setMuted] = useState(false);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    authedCall((token) => listConversations(token)).then((result) => {
      setConversation(result.conversations.find((c) => c.id === conversationId) ?? null);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  if (!conversation) {
    return (
      <div className="flex min-h-screen items-center justify-center text-text-muted" role="status">
        Loading…
      </div>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-6 py-8">
      <header className="flex items-center gap-3">
        <Link href={`/chat/${conversationId}`} className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">
          {user ? conversationDisplayName(conversation, user.id) : "…"}
        </h1>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium text-text-muted">Members</h2>
        <ul className="flex flex-col gap-1">
          {conversation.members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-control bg-bg-surface-raised px-3 py-2 text-sm text-text-primary"
            >
              <Avatar name={member.displayName} avatarUrl={member.avatarUrl} size="sm" />
              {member.displayName} {member.userId === user?.id && <span className="text-text-muted">(you)</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <label className="flex items-center justify-between text-sm text-text-primary">
          Mute notifications
          <input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} />
        </label>
        <label className="flex items-center justify-between text-sm text-text-primary">
          Pin to top
          <input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />
        </label>
        <p className="text-xs text-text-muted">
          Mute and pin are saved on this device only for now — synced preferences are a later addition.
        </p>
      </section>
    </main>
  );
}

export default function ConversationSettingsPage() {
  return (
    <RequireAuth>
      <ConversationSettingsContent />
    </RequireAuth>
  );
}
