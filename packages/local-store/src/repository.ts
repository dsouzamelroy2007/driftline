import { and, asc, desc, eq, lt } from "drizzle-orm";

import { conversationCursors, outbox, timelineEntries, type OutboxEntry, type OutboxStatus, type TimelineEntry } from "./schema.js";
import type { LocalStoreDb, LocalStoreTx } from "./types.js";

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

    await tx.insert(timelineEntries).values({
      conversationId: envelope.conversationId,
      kind: "message",
      envelopeId: envelope.envelopeId,
      senderId: envelope.senderId,
      senderDeviceId: envelope.senderDeviceId,
      seq: envelope.seq,
      contentType: envelope.contentType,
      payload: envelope.payload,
      createdAt: envelope.createdAt,
    });

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

export interface NewOutboxInput {
  clientId: string;
  conversationId: string;
  contentType: string;
  payload: string;
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

    await tx.insert(timelineEntries).values({
      conversationId: input.conversationId,
      kind: "message",
      envelopeId: input.envelopeId,
      senderId: input.senderId,
      senderDeviceId: input.senderDeviceId,
      seq: input.seq,
      contentType: input.contentType,
      payload: input.payload,
      createdAt: input.createdAt,
    });
  });
}
