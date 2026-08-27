"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Avatar } from "../../../components/avatar";
import { RequireAuth } from "../../../components/auth-gate";
import { ApiError, createConversation, lookupUserByEmail } from "../../../lib/api-client";
import { useAuth } from "../../../lib/auth-context";
import { errorTextClass, inputClass, primaryButtonClass, secondaryButtonCompactClass } from "../../../lib/ui-classes";
import type { User } from "../../../lib/types";

function NewChatContent() {
  const { authedCall, user: self } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [participants, setParticipants] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const trimmed = email.trim();
    if (!trimmed) return;
    if (trimmed === self?.email) {
      setError("That's your own email.");
      return;
    }
    if (participants.some((participant) => participant.email === trimmed)) {
      setError("Already added.");
      return;
    }

    setBusy(true);
    try {
      const { user } = await authedCall((token) => lookupUserByEmail(token, trimmed));
      setParticipants((current) => [...current, user]);
      setEmail("");
    } catch (lookupError) {
      setError(lookupError instanceof ApiError && lookupError.status === 404 ? "No Driftline user with that email." : "Couldn't look that up. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    setError(null);
    setBusy(true);
    try {
      const { conversation } = await authedCall((token) =>
        createConversation(token, {
          type: participants.length === 1 ? "direct" : "group",
          participantUserIds: participants.map((participant) => participant.id),
        }),
      );
      router.push(`/chat/${conversation.id}`);
    } catch (startError) {
      setError(startError instanceof ApiError ? startError.message : "Couldn't start the chat. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-xl font-semibold text-text-primary">New chat</h1>
      <p className="text-sm text-text-muted">Add one person for a direct chat, or several for a group.</p>

      <form onSubmit={handleAdd} className="flex gap-2">
        <input
          className={inputClass + " min-w-0 flex-1"}
          type="email"
          placeholder="person@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button type="submit" className={secondaryButtonCompactClass} disabled={busy}>
          Add
        </button>
      </form>

      {error && (
        <p className={errorTextClass} role="alert">
          {error}
        </p>
      )}

      {participants.length > 0 && (
        <ul className="flex flex-col gap-2">
          {participants.map((participant) => (
            <li key={participant.id} className="flex items-center justify-between rounded-control bg-bg-surface-raised px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <Avatar name={participant.displayName} avatarUrl={participant.avatarUrl} size="sm" />
                {participant.displayName} <span className="text-text-muted">({participant.email})</span>
              </span>
              <button
                type="button"
                className="text-text-muted underline"
                onClick={() => setParticipants((current) => current.filter((p) => p.id !== participant.id))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className={primaryButtonClass} disabled={participants.length === 0 || busy} onClick={handleStart}>
        {busy ? "Starting…" : participants.length > 1 ? "Start group chat" : "Start chat"}
      </button>
    </main>
  );
}

export default function NewChatPage() {
  return (
    <RequireAuth>
      <NewChatContent />
    </RequireAuth>
  );
}
