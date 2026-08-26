import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * On-device chat history — the server never has this (docs/RETENTION.md). Two backends share this
 * exact schema via drizzle-orm/sqlite-proxy: node.ts (node:sqlite, tests) and browser.ts (sqlocal,
 * OPFS-backed, production) — see docs/ADR/0006-local-store-engine.md.
 */

// Just the per-conversation sync cursor (docs/REALTIME_PROTOCOL.md §3/§5, ADR-0003 §2/§3) — not a
// conversation-metadata cache. The socket protocol never pushes conversation metadata; that's REST.
export const conversationCursors = sqliteTable("conversation_cursors", {
  conversationId: text("conversation_id").primaryKey(),
  lastSeenSeq: integer("last_seen_seq").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export const timelineEntryKinds = ["message", "gap", "history_start", "dormancy_return"] as const;
export type TimelineEntryKind = (typeof timelineEntryKinds)[number];

// `id` is the local autoincrement insertion-order key — envelope IDs are random UUIDs and can't
// serve as a pagination cursor. `envelopeId` is nullable (markers don't have one) but unique when
// present, which is the redelivery dedup key (SQLite treats NULL != NULL, so multiple markers with
// no envelopeId coexist fine).
export const timelineEntries = sqliteTable(
  "timeline_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: text("conversation_id").notNull(),
    kind: text("kind", { enum: timelineEntryKinds }).notNull(),
    envelopeId: text("envelope_id"),
    senderId: text("sender_id"),
    senderDeviceId: text("sender_device_id"),
    seq: integer("seq"),
    contentType: text("content_type"),
    payload: text("payload"),
    // Only set for media messages (docs/ADR/0009-media-attachments.md): the downloaded base64 image
    // bytes, cached locally so the attachment survives after the server purges its R2 object.
    // Deliberately a separate column from `payload`, which stays exactly what was received/sent
    // over the wire (the small { r2Key, size } descriptor) — this is a local-only cache on top of it.
    attachmentPayload: text("attachment_payload"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    // Only set on kind: "gap" — the range of sequence numbers that were purged before this device
    // could fetch them (docs/RETENTION.md §6 point 1).
    gapFromSeq: integer("gap_from_seq"),
    gapToSeq: integer("gap_to_seq"),
  },
  (table) => [
    uniqueIndex("timeline_entries_envelope_id_unique").on(table.envelopeId),
    index("timeline_entries_conversation_id_idx").on(table.conversationId, table.id),
  ],
);

export const outboxStatuses = ["pending", "sending", "failed"] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

// Locally-queued sends not yet acknowledged by the server (docs/REALTIME_PROTOCOL.md's
// message:send ack callback) — the offline outbox from docs/ROADMAP.md's MVP cut.
export const outbox = sqliteTable("outbox", {
  clientId: text("client_id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  contentType: text("content_type").notNull(),
  payload: text("payload").notNull(),
  // For an outgoing media message, the sender's own file bytes — already available locally at
  // compose time, so the optimistic bubble renders without round-tripping through upload+download
  // of its own send (docs/ADR/0009-media-attachments.md).
  attachmentPayload: text("attachment_payload"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  status: text("status", { enum: outboxStatuses }).notNull().default("pending"),
});

export type ConversationCursor = typeof conversationCursors.$inferSelect;
export type TimelineEntry = typeof timelineEntries.$inferSelect;
export type NewTimelineEntry = typeof timelineEntries.$inferInsert;
export type OutboxEntry = typeof outbox.$inferSelect;
export type NewOutboxEntry = typeof outbox.$inferInsert;
