import { randomUUID } from "node:crypto";

import { conversationMembers, conversationSequences, conversations, createDbClient, devices, envelopes, users, type Db } from "@driftline/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { sendEnvelope } from "./envelopes.service.js";
import { checkRetentionCompliance } from "./retention-monitor.js";

const RETENTION_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function requireTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run this suite — see retention.integration.test.ts.");
  }
  return url;
}

let db: Db;

beforeAll(() => {
  db = createDbClient(requireTestDatabaseUrl());
});

async function seedUserAndDevice() {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Test User" }).returning();
  const [device] = await db.insert(devices).values({ userId: user!.id, platform: "web" }).returning();
  return { user: user!, device: device! };
}

async function seedDirectConversation(memberUserIds: string[]) {
  const [conversation] = await db.insert(conversations).values({ type: "direct" }).returning();
  await db.insert(conversationSequences).values({ conversationId: conversation!.id, seq: 0 });
  await db.insert(conversationMembers).values(memberUserIds.map((userId) => ({ conversationId: conversation!.id, userId })));
  return conversation!;
}

describe("checkRetentionCompliance", () => {
  it("is compliant when the oldest envelope in the table is well within the retention window", async () => {
    const sender = await seedUserAndDevice();
    const recipient = await seedUserAndDevice();
    const conversation = await seedDirectConversation([sender.user.id, recipient.user.id]);

    await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "aGVsbG8=",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });

    // Other suites in this same run leave their own (equally fresh) envelopes behind, but nothing
    // in the test suite is ever actually 30 days old, so this holds regardless of run order.
    const result = await checkRetentionCompliance(db, RETENTION_WINDOW_DAYS);
    expect(result.compliant).toBe(true);
  });

  it("flags a violation when an envelope has silently outlived the retention window — the sweeper-is-broken case", async () => {
    const sender = await seedUserAndDevice();
    const recipient = await seedUserAndDevice();
    const conversation = await seedDirectConversation([sender.user.id, recipient.user.id]);

    const { envelope } = await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "aGVsbG8=",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });

    // Simulates the sweeper having failed to run for over a month: back-date createdAt directly,
    // independent of expiresAt, since this check must catch expiresAt itself being computed wrong.
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * DAY_MS);
    await db.update(envelopes).set({ createdAt: thirtyOneDaysAgo }).where(eq(envelopes.id, envelope.id));

    try {
      const result = await checkRetentionCompliance(db, RETENTION_WINDOW_DAYS);
      expect(result.compliant).toBe(false);
      expect(result.oldestEnvelopeAgeMs).not.toBeNull();
      expect(result.oldestEnvelopeAgeMs!).toBeGreaterThan(RETENTION_WINDOW_DAYS * DAY_MS);
    } finally {
      // Don't leave a permanently-old row behind in the shared test database for future runs.
      await db.delete(envelopes).where(eq(envelopes.id, envelope.id));
    }
  });
});
