"use client";

import { searchTimeline, SEARCH_SNIPPET_MARK_END, SEARCH_SNIPPET_MARK_START, type SearchResult } from "@driftline/local-store";
import Link from "next/link";
import { useEffect, useState } from "react";

import { RequireAuth } from "../../components/auth-gate";
import { listConversations } from "../../lib/api-client";
import { useAuth } from "../../lib/auth-context";
import { conversationDisplayName } from "../../lib/conversation-name";
import { useLocalStore } from "../../lib/local-store-context";
import { inputClass, linkClass } from "../../lib/ui-classes";
import type { Conversation } from "../../lib/types";

const DEBOUNCE_MS = 250;

// Renders an FTS5 snippet() result safely: splits on the control-character delimiters
// (@driftline/local-store's SEARCH_SNIPPET_MARK_START/END) and wraps only that segment in a real
// <mark> element. Deliberately never dangerouslySetInnerHTML — the surrounding text is arbitrary
// user message content, and those delimiters exist specifically so they can't collide with (or be
// mistaken for) HTML a user might have typed into a message.
function Snippet({ text }: { text: string }) {
  const startIndex = text.indexOf(SEARCH_SNIPPET_MARK_START);
  const endIndex = text.indexOf(SEARCH_SNIPPET_MARK_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return <>{text}</>;
  }

  const before = text.slice(0, startIndex);
  const highlighted = text.slice(startIndex + SEARCH_SNIPPET_MARK_START.length, endIndex);
  const after = text.slice(endIndex + SEARCH_SNIPPET_MARK_END.length);

  return (
    <>
      {before}
      <mark className="rounded bg-accent-primary/20 text-text-primary">{highlighted}</mark>
      {after}
    </>
  );
}

function SearchContent() {
  const { authedCall, user } = useAuth();
  const { db } = useLocalStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [conversations, setConversations] = useState<Record<string, Conversation>>({});
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    authedCall((token) => listConversations(token))
      .then((result) => setConversations(Object.fromEntries(result.conversations.map((c) => [c.id, c]))))
      .catch(() => setConversations({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!db || !query.trim()) {
      setResults([]);
      return;
    }

    setSearching(true);
    const handle = setTimeout(() => {
      searchTimeline(db, query)
        .then(setResults)
        .finally(() => setSearching(false));
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [db, query]);

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col">
      <header className="flex items-center gap-3 border-b border-text-muted/20 px-4 py-3">
        <Link href="/chat" className={linkClass}>
          ←
        </Link>
        <h1 className="text-lg font-semibold text-text-primary">Search</h1>
      </header>

      <div className="p-4">
        <input
          className={inputClass}
          type="search"
          placeholder="Search your messages"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoFocus
        />
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-2 pb-4">
        {searching && (
          <li className="px-2 py-1 text-sm text-text-muted" role="status">
            Searching…
          </li>
        )}
        {!searching && query.trim().length > 0 && results.length === 0 && (
          <li className="px-2 py-1 text-sm text-text-muted">No messages found.</li>
        )}
        {results.map(({ entry, snippet }) => {
          const conversation = conversations[entry.conversationId];
          return (
            <li key={entry.id}>
              <Link
                href={`/chat/${entry.conversationId}`}
                className="flex flex-col gap-0.5 rounded-control px-3 py-2 transition hover:bg-bg-surface-raised motion-reduce:transition-none"
              >
                <span className="text-sm font-medium text-text-primary">
                  {conversation && user ? conversationDisplayName(conversation, user.id) : "…"}
                </span>
                <span className="truncate text-sm text-text-muted">
                  <Snippet text={snippet} />
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export default function SearchPage() {
  return (
    <RequireAuth>
      <SearchContent />
    </RequireAuth>
  );
}
