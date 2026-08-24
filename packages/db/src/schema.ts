import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const platformEnum = pgEnum("platform", ["web", "ios", "android"]);

/**
 * Durable identity metadata only — see docs/RETENTION.md §2. No message content
 * ever lives in this schema; that's the Envelope table Phase 3 adds separately.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
