import { and, asc, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";

import { conversationCursors, outbox, timelineEntries, type OutboxEntry, type OutboxStatus, type TimelineEntry } from "./schema.js";
import { decodeTextPayload } from "./text-payload.js";
import type { LocalStoreDb, LocalStoreTx } from "./types.js";

// Only "text/plain" is ever indexed for search (searchTimeline below) — payload is base64, and
// vanilla SQLite has no base64 decoder, so a SQL trigger can't populate the FTS index; this has to
// run in application code at every insert call site instead. Other content types (once they exist)
// would index a caption/filename, not decoded bytes — not this function's concern.
//
// Never let a decode failure propagate out of this function: it always runs inside the same
// transaction as the actual message insert, and search indexing is a nice-to-have that must not be
// able to take down message delivery itself. A malformed/non-base64 payload (caught live: a
// packages/sync-engine test fixture uses plain placeholder strings, not real base64, for
// contentType "text/plain") just means that one message doesn't end up searchable — not a crashed
// insert.
async function indexMessageForSearch(tx: LocalStoreTx, entry: { id: number; contentType: string; payload: string }): Promise<void> {
  if (entry.contentType !== "text/plain") return;
  let body: string;
  try {
    body = decodeTextPayload(entry.payload);
  } catch {
    return;
  }
  await tx.run(sql`INSERT INTO timeline_entries_fts (rowid, body) VALUES (${entry.id}, ${body})`);
}

export type IncomingClassification = "duplicate" | "history_start" | "gap" | "ok";

/**
 * The classify-and-advance step shared by insertIncomingEnvelope (driven by envelope:deliver) and
 * reconcileOutboxEntry (driven by this device's own message:send ack). Both need it: a device's
 * own sent message never comes back to it as envelope:deliver (Phase 3's sendEnvelope excludes the
 * sending device from fan-out), so without advancing the cursor here too, a later-arriving
 * envelope from someone else could wrongly appear to have "skipped over" this device's own
 * message, producing a bogus gap marker for a seq this device actually already has.
 *
 * Trade-off, left as a known limitation rather than solved here: if this device's own send lands
 * at seq N while a lower seq from another sender is still in flight to this device (a real,
 * ordinary network race — seq order reflects server processing order, not per-device delivery
 * order), this can insert a gap marker that turns out to be spurious once the lower-seq envelope
 * arrives moments later. Preferred over the alternative (not advancing the cursor for own sends),
 * which risks silently misclassifying a later, genuinely-pending envelope as a stale duplicate —
 * i.e. real data loss vs. an occasional over-cautious gap notice. Retroactively clearing a gap
 * marker once the "missing" envelope turns out to have arrived is a reasonable follow-up, not
 * attempted in Phase 4.
 */
async function classifyAndAdvanceCursor(
  tx: LocalStoreTx,
  params: { conversationId: string; seq: number; createdAt: Date },
): Promise<IncomingClassification> {
  const [cursorRow] = await tx
    .select()
    .from(conversationCursors)
    .where(eq(conversationCursors.conversationId, params.conversationId));

  if (cursorRow && params.seq <= cursorRow.lastSeenSeq) {
    return "duplicate";
  }

  let classification: IncomingClassification;
  if (!cursorRow) {
    classification = "history_start";
    await tx.insert(timelineEntries).values({
      conversationId: params.conversationId,
      kind: "history_start",
      createdAt: params.createdAt,
    });
  } else if (params.seq > cursorRow.lastSeenSeq + 1) {
    classification = "gap";
    await tx.insert(timelineEntries).values({
      conversationId: params.conversationId,
      kind: "gap",
      createdAt: params.createdAt,
      gapFromSeq: cursorRow.lastSeenSeq + 1,
      gapToSeq: params.seq - 1,
    });
  } else {
    classification = "ok";
  }

  if (cursorRow) {
    await tx
      .update(conversationCursors)
      .set({ lastSeenSeq: params.seq, updatedAt: params.createdAt })
      .where(eq(conversationCursors.conversationId, params.conversationId));
  } else {
    await tx.insert(conversationCursors).values({
      conversationId: params.conversationId,
      lastSeenSeq: params.seq,
      updatedAt: params.createdAt,
    });
  }

  return classification;
}

export interface IncomingEnvelope {
  envelopeId: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  seq: number;
  contentType: string;
  payload: string;
  // The downloaded attachment bytes for a media message (docs/ADR/0009-media-attachments.md) —
  // the caller (packages/sync-engine) must have already durably fetched these before calling this
  // function, since insertion is what allows the caller to then ack, and once acked the server's
  // R2 object can be purged at any time.
  attachmentPayload?: string;
  createdAt: Date;
}

export interface InsertIncomingEnvelopeResult {
  classification: IncomingClassification;
}

// docs/REALTIME_PROTOCOL.md's envelope:deliver handler. One transaction, so a crash between the
// timeline insert and the cursor advance can't happen — that's what makes classifyAndAdvanceCursor's
// "seq <= cursor implies already fully processed" duplicate check sound.
export async function insertIncomingEnvelope(db: LocalStoreDb, envelope: IncomingEnvelope): Promise<InsertIncomingEnvelopeResult> {
  return db.transaction(async (tx) => {
    const classification = await classifyAndAdvanceCursor(tx, {
      conversationId: envelope.conversationId,
      seq: envelope.seq,
      createdAt: envelope.createdAt,
    });

    if (classification === "duplicate") {
      return { classification };
    }

    const [inserted] = await tx
      .insert(timelineEntries)
      .values({
        conversationId: envelope.conversationId,
        kind: "message",
        envelopeId: envelope.envelopeId,
        senderId: envelope.senderId,
        senderDeviceId: envelope.senderDeviceId,
        seq: envelope.seq,
        contentType: envelope.contentType,
        payload: envelope.payload,
        attachmentPayload: envelope.attachmentPayload,
        createdAt: envelope.createdAt,
      })
      .returning({ id: timelineEntries.id });

    await indexMessageForSearch(tx, { id: inserted!.id, contentType: envelope.contentType, payload: envelope.payload });

    return { classification };
  });
}

export async function getConversationCursor(db: LocalStoreDb, conversationId: string): Promise<number | undefined> {
  const [row] = await db.select().from(conversationCursors).where(eq(conversationCursors.conversationId, conversationId));
  return row?.lastSeenSeq;
}

export async function listKnownConversationIds(db: LocalStoreDb): Promise<string[]> {
  const rows = await db.select({ conversationId: conversationCursors.conversationId }).from(conversationCursors);
  return rows.map((row) => row.conversationId);
}

// docs/RETENTION.md §6 point 2: dormancy:return carries no conversationId (it's device-level), and
// a conversation that got zero envelope:deliver events after reconnect would never otherwise raise
// a gap. A conversation with no prior cursor is skipped — it'll correctly self-classify as
// history_start whenever it next gets an envelope, so a dormancy marker there would be redundant.
export async function insertDormancyReturnMarkers(db: LocalStoreDb, createdAt: Date): Promise<void> {
  const conversationIds = await listKnownConversationIds(db);
  if (conversationIds.length === 0) return;

  await db.insert(timelineEntries).values(
    conversationIds.map((conversationId) => ({
      conversationId,
      kind: "dormancy_return" as const,
      createdAt,
    })),
  );
}

export interface ListTimelineOptions {
  limit?: number;
  beforeId?: number;
}

// Newest-first, paginated by the local integer id (not envelopeId — random UUIDs aren't sortable).
export async function listTimeline(
  db: LocalStoreDb,
  conversationId: string,
  options: ListTimelineOptions = {},
): Promise<TimelineEntry[]> {
  const limit = options.limit ?? 50;
  const conditions = [eq(timelineEntries.conversationId, conversationId)];
  if (options.beforeId !== undefined) {
    conditions.push(lt(timelineEntries.id, options.beforeId));
  }

  return db
    .select()
    .from(timelineEntries)
    .where(and(...conditions))
    .orderBy(desc(timelineEntries.id))
    .limit(limit);
}

// Full, unpaginated history for one conversation, oldest-first — used by backup export and
// device-linking transfer (packages/backup), which need everything, not a page of it. Not used by
// any live-sync path; listTimeline's newest-first pagination remains the UI's read path.
export async function listAllTimelineEntries(db: LocalStoreDb, conversationId: string): Promise<TimelineEntry[]> {
  return db
    .select()
    .from(timelineEntries)
    .where(and(eq(timelineEntries.conversationId, conversationId), eq(timelineEntries.kind, "message")))
    .orderBy(asc(timelineEntries.id));
}

export interface ImportEntryInput {
  envelopeId: string;
  senderId: string;
  senderDeviceId: string;
  seq: number;
  contentType: string;
  payload: string;
  // Not yet populated by packages/backup's export/import or device-linking transfer (Phase 6 parts
  // 1/2b didn't wire attachment bytes through either flow — a documented limitation, see
  // docs/ADR/0009-media-attachments.md) — accepted here regardless so this function is ready for
  // whenever that's added, without another schema/signature change.
  attachmentPayload?: string;
  createdAt: Date;
}

export interface ImportConversationInput {
  conversationId: string;
  cursorSeq: number;
  entries: ImportEntryInput[];
}

export interface ImportTimelineEntriesResult {
  conversationsImported: number;
  entriesImported: number;
}

// Bulk-writes historical data from a decrypted backup file or a completed device-linking transfer
// (packages/backup) — deliberately bypasses classifyAndAdvanceCursor, which assumes strictly
// sequential server-assigned seq and isn't meaningful for a batch of already-ordered history. Dedup
// is via the existing envelopeId UNIQUE index (re-importing the same backup twice is a no-op, not an
// error). The cursor is advanced to the *max* of whatever it already was and the imported
// conversation's cursorSeq, never backwards — importing an old backup onto a device with newer
// independent history must not regress its live-sync cursor.
//
// Correct chronological rendering (listTimeline orders by local insertion id) is only guaranteed
// when the target conversation has no prior local rows, which is the designed use case (ADR-0003:
// new/reinstalled devices always start empty). Callers must pass entries pre-sorted oldest-first;
// importing into a non-empty conversation is allowed (the "divergent but self-consistent" case
// ADR-0003 anticipates) but its resulting local order is a documented known limitation, not fixed
// here. The outbox table is intentionally untouched by import — it is a separate, unrelated concern.
export async function importTimelineEntries(
  db: LocalStoreDb,
  conversations: ImportConversationInput[],
): Promise<ImportTimelineEntriesResult> {
  let entriesImported = 0;

  await db.transaction(async (tx) => {
    for (const conversation of conversations) {
      for (const entry of conversation.entries) {
        const [inserted] = await tx
          .insert(timelineEntries)
          .values({
            conversationId: conversation.conversationId,
            kind: "message",
            envelopeId: entry.envelopeId,
            senderId: entry.senderId,
            senderDeviceId: entry.senderDeviceId,
            seq: entry.seq,
            contentType: entry.contentType,
            payload: entry.payload,
            attachmentPayload: entry.attachmentPayload,
            createdAt: entry.createdAt,
          })
          .onConflictDoNothing({ target: timelineEntries.envelopeId })
          .returning({ id: timelineEntries.id });

        // onConflictDoNothing means a dedup-skipped entry (re-importing the same backup) returns
        // no row — only index entries that were actually newly written.
        if (inserted) {
          await indexMessageForSearch(tx, { id: inserted.id, contentType: entry.contentType, payload: entry.payload });
        }
        entriesImported += 1;
      }

      const [cursorRow] = await tx
        .select()
        .from(conversationCursors)
        .where(eq(conversationCursors.conversationId, conversation.conversationId));

      if (!cursorRow) {
        await tx.insert(conversationCursors).values({
          conversationId: conversation.conversationId,
          lastSeenSeq: conversation.cursorSeq,
          updatedAt: new Date(),
        });
      } else if (conversation.cursorSeq > cursorRow.lastSeenSeq) {
        await tx
          .update(conversationCursors)
          .set({ lastSeenSeq: conversation.cursorSeq, updatedAt: new Date() })
          .where(eq(conversationCursors.conversationId, conversation.conversationId));
      }
    }
  });

  return { conversationsImported: conversations.length, entriesImported };
}

// Powers the Inbox's unread badge (docs/UI_DIRECTION.md §2) — the "read" boundary itself is tracked
// client-side (apps/web's localStorage, not this schema), since it's a per-viewport UI concern, not
// sync/delivery state; this just counts "message" entries newer than whatever id the caller passes.
export async function countMessagesAfter(db: LocalStoreDb, conversationId: string, afterId: number): Promise<number> {
  const rows = await db
    .select({ id: timelineEntries.id })
    .from(timelineEntries)
    .where(and(eq(timelineEntries.conversationId, conversationId), eq(timelineEntries.kind, "message"), gt(timelineEntries.id, afterId)));
  return rows.length;
}

export interface NewOutboxInput {
  clientId: string;
  conversationId: string;
  contentType: string;
  payload: string;
  // For an outgoing media message, the sender's own file bytes (docs/ADR/0009-media-attachments.md).
  attachmentPayload?: string;
  createdAt: Date;
}

export async function appendOutboxEntry(db: LocalStoreDb, entry: NewOutboxInput): Promise<void> {
  await db.insert(outbox).values({ ...entry, status: "pending" });
}

export async function listOutboxEntries(db: LocalStoreDb): Promise<OutboxEntry[]> {
  return db.select().from(outbox).orderBy(asc(outbox.createdAt));
}

export async function setOutboxEntryStatus(db: LocalStoreDb, clientId: string, status: OutboxStatus): Promise<void> {
  await db.update(outbox).set({ status }).where(eq(outbox.clientId, clientId));
}

export interface ReconcileOutboxInput {
  clientId: string;
  envelopeId: string;
  seq: number;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  contentType: string;
  payload: string;
  attachmentPayload?: string;
  createdAt: Date;
}

// The ack-callback success path for a locally-sent message (docs/REALTIME_PROTOCOL.md's
// message:send): removes the optimistic outbox row and writes the confirmed timeline entry with
// the server-assigned envelopeId/seq, in the same transaction as the cursor advance (see
// classifyAndAdvanceCursor's doc comment for why the cursor is touched here at all).
export async function reconcileOutboxEntry(db: LocalStoreDb, input: ReconcileOutboxInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(outbox).where(eq(outbox.clientId, input.clientId));

    await classifyAndAdvanceCursor(tx, {
      conversationId: input.conversationId,
      seq: input.seq,
      createdAt: input.createdAt,
    });

    const [inserted] = await tx
      .insert(timelineEntries)
      .values({
        conversationId: input.conversationId,
        kind: "message",
        envelopeId: input.envelopeId,
        senderId: input.senderId,
        senderDeviceId: input.senderDeviceId,
        seq: input.seq,
        contentType: input.contentType,
        payload: input.payload,
        attachmentPayload: input.attachmentPayload,
        createdAt: input.createdAt,
      })
      .returning({ id: timelineEntries.id });

    await indexMessageForSearch(tx, { id: inserted!.id, contentType: input.contentType, payload: input.payload });
  });
}

export interface SearchResult {
  entry: TimelineEntry;
  snippet: string;
}

const FTS_SNIPPET_COLUMN_INDEX = 0; // timeline_entries_fts has a single column, `body`.
const DEFAULT_SEARCH_LIMIT = 30;

// snippet()'s start/end markers for the matched term, deliberately unprintable control characters
// rather than HTML tags like <mark>: a message body is arbitrary user text that could itself
// contain the literal string "<mark>" — a renderer using dangerouslySetInnerHTML on that would be
// a real XSS hole, and even a safe split-based renderer would misparse a body that happens to
// contain the literal delimiter text. SOH/STX (0x01/0x02) essentially never appear in normal chat
// text and carry no HTML meaning either way. Exported as character codes, not the literal
// characters, to avoid an invisible-character footgun in this source file.
export const SEARCH_SNIPPET_MARK_START = String.fromCharCode(1);
export const SEARCH_SNIPPET_MARK_END = String.fromCharCode(2);

// Wraps user input as an AND-of-quoted-tokens FTS5 query, with a trailing prefix match on the last
// token (search-as-you-type) — never interpolates raw text into a MATCH expression, since FTS5's
// query syntax has its own operators (AND/OR/NOT/*/-/quotes) a message body could accidentally or
// deliberately trigger.
function sanitizeFtsQuery(query: string): string {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  return tokens.map((token, i) => `"${token.replace(/"/g, '""')}"${i === tokens.length - 1 ? "*" : ""}`).join(" ");
}

export interface SearchTimelineOptions {
  limit?: number;
}

// Client-side full-text search over this device's own message history — the server never has this
// data at rest, so there's no server-side equivalent (docs/DESIGN_REVIEW.md). Only "message" kind
// entries with contentType "text/plain" are ever indexed (indexMessageForSearch above); markers and
// other content types never appear in results.
export async function searchTimeline(db: LocalStoreDb, query: string, options: SearchTimelineOptions = {}): Promise<SearchResult[]> {
  const ftsQuery = sanitizeFtsQuery(query);
  if (!ftsQuery) return [];

  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  // Raw sql`` queries return positional arrays, not keyed objects, through drizzle-orm/sqlite-proxy
  // (see migrate.ts's comment for the exact same gotcha) — index by position, not by name.
  const matches = await db.all<[number, string]>(sql`
    SELECT rowid, snippet(timeline_entries_fts, ${FTS_SNIPPET_COLUMN_INDEX}, ${SEARCH_SNIPPET_MARK_START}, ${SEARCH_SNIPPET_MARK_END}, '…', 8)
    FROM timeline_entries_fts
    WHERE timeline_entries_fts MATCH ${ftsQuery}
    ORDER BY rank
    LIMIT ${limit}
  `);
  if (matches.length === 0) return [];

  const snippetsById = new Map(matches.map(([id, snippet]) => [id, snippet]));
  const matchedIds = matches.map(([id]) => id);

  const entries = await db.select().from(timelineEntries).where(inArray(timelineEntries.id, matchedIds));
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));

  // Re-sort into the FTS relevance order — the .select() above doesn't preserve it.
  return matchedIds
    .map((id) => {
      const entry = entriesById.get(id);
      const snippet = snippetsById.get(id);
      return entry && snippet !== undefined ? { entry, snippet } : null;
    })
    .filter((result): result is SearchResult => result !== null);
}
