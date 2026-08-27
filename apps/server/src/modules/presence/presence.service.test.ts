import { randomUUID } from "node:crypto";

import { conversationMembers, conversationSequences, conversations, createDbClient, devices, users, type Db } from "@driftline/db";
import { beforeAll, describe, expect, it } from "vitest";

import { getActiveDeviceIds, getActiveDeviceIdsForUsers, getConversationPartnerUserIds } from "./presence.service.js";

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

async function seedUser() {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName: "Test User" }).returning();
  return user!;
}

async function seedDevice(userId: string, overrides: Partial<{ revokedAt: Date; dormantAt: Date }> = {}) {
  const [device] = await db.insert(devices).values({ userId, platform: "web", ...overrides }).returning();
  return device!;
}

async function seedConversation(type: "direct" | "group", memberUserIds: string[]) {
  const [conversation] = await db.insert(conversations).values({ type }).returning();
  await db.insert(conversationSequences).values({ conversationId: conversation!.id, seq: 0 });
  await db.insert(conversationMembers).values(memberUserIds.map((userId) => ({ conversationId: conversation!.id, userId })));
  return conversation!;
}

describe("getActiveDeviceIds", () => {
  it("returns only non-revoked, non-dormant devices", async () => {
    const user = await seedUser();
    const active = await seedDevice(user.id);
    await seedDevice(user.id, { revokedAt: new Date() });
    await seedDevice(user.id, { dormantAt: new Date() });

    const ids = await getActiveDeviceIds(db, user.id);

    expect(ids).toEqual([active.id]);
  });

  it("returns an empty array for a user with no devices", async () => {
    const user = await seedUser();
    expect(await getActiveDeviceIds(db, user.id)).toEqual([]);
  });
});

describe("getConversationPartnerUserIds", () => {
  it("finds every other user sharing at least one conversation, deduplicated", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const carol = await seedUser();
    await seedConversation("direct", [alice.id, bob.id]);
    await seedConversation("group", [alice.id, bob.id, carol.id]);

    const partners = await getConversationPartnerUserIds(db, alice.id);

    expect([...partners].sort()).toEqual([bob.id, carol.id].sort());
  });

  it("never includes the user themselves", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    await seedConversation("direct", [alice.id, bob.id]);

    const partners = await getConversationPartnerUserIds(db, alice.id);

    expect(partners).not.toContain(alice.id);
  });

  it("returns an empty array for a user in no conversations", async () => {
    const alice = await seedUser();
    expect(await getConversationPartnerUserIds(db, alice.id)).toEqual([]);
  });
});

describe("getActiveDeviceIdsForUsers", () => {
  it("collects active devices across multiple users", async () => {
    const alice = await seedUser();
    const bob = await seedUser();
    const aliceDevice = await seedDevice(alice.id);
    const bobDevice = await seedDevice(bob.id);
    await seedDevice(bob.id, { revokedAt: new Date() });

    const ids = await getActiveDeviceIdsForUsers(db, [alice.id, bob.id]);

    expect([...ids].sort()).toEqual([aliceDevice.id, bobDevice.id].sort());
  });

  it("short-circuits to an empty array without querying for an empty input", async () => {
    expect(await getActiveDeviceIdsForUsers(db, [])).toEqual([]);
  });
});
