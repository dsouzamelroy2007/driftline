import { integer, pgEnum, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["web", "ios", "android"]);
export const conversationTypeEnum = pgEnum("conversation_type", ["direct", "group"]);
export const conversationRoleEnum = pgEnum("conversation_role", ["member", "admin"]);
export const envelopeTargetStatusEnum = pgEnum("envelope_target_status", ["pending", "delivered"]);

/**
 * Durable identity metadata only — see docs/RETENTION.md §2. No message content
 * ever lives in this schema; that's the Envelope table Phase 3 adds separately.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  // Nullable: OAuth- and magic-link-only accounts never set a password.
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.provider, table.providerAccountId)],
);

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  // Unused until Phase 6 device-linking; present now because schema changes
  // after Phase 3 need approval and docs/RETENTION.md §2 fixes this field.
  publicKey: text("public_key"),
  pushToken: text("push_token"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  dormantAt: timestamp("dormant_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  refreshTokenHash: text("refresh_token_hash"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type OAuthAccount = typeof oauthAccounts.$inferSelect;
export type NewOAuthAccount = typeof oauthAccounts.$inferInsert;

/**
 * Relay core (Phase 3, docs/RETENTION.md, ADR-0002, ADR-0003). Conversation/membership/sequence
 * are durable routing metadata. Envelope/EnvelopeTarget are the transient content path — see the
 * column-level comments below for what's deliberately NOT durable here.
 */
export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: conversationTypeEnum("type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: conversationRoleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.conversationId, table.userId)],
);

// One row per conversation. A monotonic counter, not content — survives under ADR-0002 and gives
// devices sequence-gap detection (ADR-0003 §3) without a durable message ledger.
export const conversationSequences = pgTable("conversation_sequences", {
  conversationId: uuid("conversation_id")
    .primaryKey()
    .references(() => conversations.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull().default(0),
});

// Message/receipt/reaction body — opaque bytes (base64 text) the server never parses. Deleted the
// instant the last EnvelopeTarget acks, or unconditionally at expiresAt (docs/RETENTION.md §3).
export const envelopes = pgTable("envelopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  senderDeviceId: uuid("sender_device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  contentType: text("content_type").notNull(),
  payload: text("payload").notNull(),
  // Byte length of payload, stored redundantly so purge log lines never touch payload itself.
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// One row per (envelope, target device). onDelete: "cascade" on envelopeId is what makes purging
// an envelope also purge every target row in the same statement (docs/RETENTION.md §3/§4) — a
// dormant-at-send-time device gets no row at all ("excluded" is never a stored status here).
export const envelopeTargets = pgTable(
  "envelope_targets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    envelopeId: uuid("envelope_id")
      .notNull()
      .references(() => envelopes.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    status: envelopeTargetStatusEnum("status").notNull().default("pending"),
  },
  (table) => [unique().on(table.envelopeId, table.deviceId)],
);

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type NewConversationMember = typeof conversationMembers.$inferInsert;
export type ConversationSequence = typeof conversationSequences.$inferSelect;
export type Envelope = typeof envelopes.$inferSelect;
export type NewEnvelope = typeof envelopes.$inferInsert;
export type EnvelopeTarget = typeof envelopeTargets.$inferSelect;
export type NewEnvelopeTarget = typeof envelopeTargets.$inferInsert;
