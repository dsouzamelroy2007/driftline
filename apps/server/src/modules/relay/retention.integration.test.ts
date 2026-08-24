import { randomUUID } from "node:crypto";

import {
  conversationMembers,
  conversationSequences,
  conversations,
  createDbClient,
  devices,
  envelopeTargets,
  envelopes,
  users,
  type Db,
} from "@driftline/db";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { revokeDevice } from "../devices/devices.service.js";
import { ackEnvelope, sendEnvelope } from "./envelopes.service.js";
import { sweepExpiredEnvelopes } from "./sweeper.js";

// This suite is docs/ROADMAP.md's Phase 3 exit gate: proof, against a real Postgres (not a mock),
// that zero message bodies survive once every recipient device has acked, and that the 30-day
// expiry cutoff purges regardless of ack state. See docker-compose.yml for the local test DB.
const RETENTION_WINDOW_DAYS = 30;

function requireTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required to run relay integration tests. Start the local Postgres with " +
        "`docker compose up -d` at the repo root, then run migrations and set DATABASE_URL, e.g. " +
        "postgres://driftline:driftline@localhost:5433/driftline_test",
    );
  }
  return url;
}

let db: Db;

beforeAll(() => {
  db = createDbClient(requireTestDatabaseUrl());
});

async function seedUserAndDevice() {
  const [user] = await db
    .insert(users)
    .values({ email: `${randomUUID()}@example.com`, displayName: "Test User" })
    .returning();
  const [device] = await db.insert(devices).values({ userId: user!.id, platform: "web" }).returning();
  return { user: user!, device: device! };
}

async function seedConversation(type: "direct" | "group", memberUserIds: string[]) {
  const [conversation] = await db.insert(conversations).values({ type }).returning();
  await db.insert(conversationSequences).values({ conversationId: conversation!.id, seq: 0 });
  await db.insert(conversationMembers).values(
    memberUserIds.map((userId) => ({ conversationId: conversation!.id, userId })),
  );
  return conversation!;
}

async function envelopeExists(envelopeId: string): Promise<boolean> {
  const rows = await db.select({ id: envelopes.id }).from(envelopes).where(eq(envelopes.id, envelopeId));
  return rows.length > 0;
}

async function targetCount(envelopeId: string): Promise<number> {
  const rows = await db
    .select({ id: envelopeTargets.id })
    .from(envelopeTargets)
    .where(eq(envelopeTargets.envelopeId, envelopeId));
  return rows.length;
}

describe("retention: ack-triggered purge", () => {
  it("deletes the envelope and every target the instant the only recipient device acks", async () => {
    const sender = await seedUserAndDevice();
    const recipient = await seedUserAndDevice();
    const conversation = await seedConversation("direct", [sender.user.id, recipient.user.id]);

    const { envelope, targetDeviceIds } = await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "aGVsbG8=",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });

    expect(targetDeviceIds).toEqual([recipient.device.id]);
    expect(await envelopeExists(envelope.id)).toBe(true);

    const result = await ackEnvelope(db, { envelopeId: envelope.id, deviceId: recipient.device.id });

    expect(result.purged).toBe(true);
    expect(await envelopeExists(envelope.id)).toBe(false);
    expect(await targetCount(envelope.id)).toBe(0);
  });

  it("does not purge until every recipient device has acked", async () => {
    const sender = await seedUserAndDevice();
    const memberB = await seedUserAndDevice();
    const memberC = await seedUserAndDevice();
    const conversation = await seedConversation("group", [sender.user.id, memberB.user.id, memberC.user.id]);

    const { envelope, targetDeviceIds } = await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "Z3JvdXA=",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });
    expect([...targetDeviceIds].sort()).toEqual([memberB.device.id, memberC.device.id].sort());

    const firstAck = await ackEnvelope(db, { envelopeId: envelope.id, deviceId: memberB.device.id });
    expect(firstAck.purged).toBe(false);
    expect(await envelopeExists(envelope.id)).toBe(true);

    const secondAck = await ackEnvelope(db, { envelopeId: envelope.id, deviceId: memberC.device.id });
    expect(secondAck.purged).toBe(true);
    expect(await envelopeExists(envelope.id)).toBe(false);
    expect(await targetCount(envelope.id)).toBe(0);
  });

  it("purges exactly once when the last two targets ack concurrently", async () => {
    const sender = await seedUserAndDevice();
    const memberB = await seedUserAndDevice();
    const memberC = await seedUserAndDevice();
    const conversation = await seedConversation("group", [sender.user.id, memberB.user.id, memberC.user.id]);

    const { envelope } = await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "cmFjZQ==",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });

    const [resultB, resultC] = await Promise.all([
      ackEnvelope(db, { envelopeId: envelope.id, deviceId: memberB.device.id }),
      ackEnvelope(db, { envelopeId: envelope.id, deviceId: memberC.device.id }),
    ]);

    const purgedCount = [resultB, resultC].filter((result) => result.purged).length;
    expect(purgedCount).toBe(1);
    expect(await envelopeExists(envelope.id)).toBe(false);
    expect(await targetCount(envelope.id)).toBe(0);
  });
});

describe("retention: expiry sweep", () => {
  it("purges an envelope past its expiry regardless of pending target state", async () => {
    const sender = await seedUserAndDevice();
    const recipient = await seedUserAndDevice();
    const conversation = await seedConversation("direct", [sender.user.id, recipient.user.id]);

    const { envelope } = await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "ZXhwaXJlZA==",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });

    // Simulates the 30-day window elapsing without the recipient ever acking.
    await db.update(envelopes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(envelopes.id, envelope.id));

    const result = await sweepExpiredEnvelopes(db);

    expect(result.purgedCount).toBeGreaterThanOrEqual(1);
    expect(await envelopeExists(envelope.id)).toBe(false);
    expect(await targetCount(envelope.id)).toBe(0);
  });
});

describe("retention: device revocation", () => {
  it("purges an envelope whose last pending target is removed by revocation", async () => {
    const sender = await seedUserAndDevice();
    const recipient = await seedUserAndDevice();
    const conversation = await seedConversation("direct", [sender.user.id, recipient.user.id]);

    const { envelope } = await sendEnvelope(db, {
      conversationId: conversation.id,
      senderId: sender.user.id,
      senderDeviceId: sender.device.id,
      contentType: "text/plain",
      payload: "cmV2b2tl",
      retentionWindowDays: RETENTION_WINDOW_DAYS,
    });
    expect(await envelopeExists(envelope.id)).toBe(true);

    const revoked = await revokeDevice(db, recipient.device.id, recipient.user.id);

    expect(revoked).toBe(true);
    expect(await envelopeExists(envelope.id)).toBe(false);
    expect(await targetCount(envelope.id)).toBe(0);
  });
});
