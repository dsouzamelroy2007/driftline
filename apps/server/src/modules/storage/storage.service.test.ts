import { randomUUID } from "node:crypto";

import { conversationMembers, conversationSequences, conversations, createDbClient, devices, users, type Db } from "@driftline/db";
import { beforeAll, describe, expect, it } from "vitest";

import { sendEnvelope } from "../relay/envelopes.service.js";
import { getStorageSummary } from "./storage.service.js";

const RETENTION_WINDOW_DAYS = 30;

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

async function seedConversation(type: "direct" | "group", memberUserIds: string[]) {
  const [conversation] = await db.insert(conversations).values({ type }).returning();
  await db.insert(conversationSequences).values({ conversationId: conversation!.id, seq: 0 });
  await db.insert(conversationMembers).values(memberUserIds.map((userId) => ({ conversationId: conversation!.id, userId })));
  return conversation!;
}

describe("getStorageSummary", () => {
  it("counts zero for a user with nothing pending", async () => {
    const user = await seedUserAndDevice();
    const summary = await getStorageSummary(db, user.user.id);
    expect(summary).toEqual({ envelopeCount: 0, oldestExpiresAt: null });
  });

  it("counts one message per envelope, not per target device", async () => {
    const sender = await seedUserAndDevice();
    const recipient = await seedUserAndDevice();
    // A second device for the recipient — sendEnvelope fans out to every active device of every
    // member, so this proves the count is per-envelope, not per-target-row.
    await db.insert(devices).values({ userId: recipient.user.id, platform: "web" });
    const conversation = await seedConversation("direct", [sender.user.id, recipient.user.id]);

    await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "aGVsbG8=",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });

    const summary = await getStorageSummary(db, recipient.user.id);

    expect(summary.envelopeCount).toBe(1);
    expect(summary.oldestExpiresAt).not.toBeNull();
  });
});
