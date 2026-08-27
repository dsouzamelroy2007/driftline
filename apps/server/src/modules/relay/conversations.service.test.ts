import { randomUUID } from "node:crypto";

import { createDbClient, users, type Db } from "@driftline/db";
import type { S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";

import type { R2Context } from "../../plugins/app-context.js";
import { createConversation, getDirectConversationOtherMember, listConversationsForUser } from "./conversations.service.js";

function requireTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run this suite — see retention.integration.test.ts.");
  }
  return url;
}

let db: Db;
// Never actually called: these seeded users have no avatarUrl, so resolveAvatarUrl short-circuits
// on null before touching the client/bucket at all.
const r2: R2Context = { client: {} as S3Client, bucket: "test-bucket" };
// This suite never connects a real socket, so nobody is ever "online" — a constant false is enough.
const isOnline = () => false;

beforeAll(() => {
  db = createDbClient(requireTestDatabaseUrl());
});

async function seedUser(displayName: string) {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName }).returning();
  return user!;
}

describe("conversations members", () => {
  it("attaches both members' display names to a new direct conversation", async () => {
    const creator = await seedUser("Alice");
    const participant = await seedUser("Bob");

    const conversation = await createConversation(
      db,
      r2,
      { type: "direct", creatorId: creator.id, participantUserIds: [participant.id] },
      isOnline,
    );

    expect(conversation.members).toHaveLength(2);
    expect(conversation.members.map((member) => member.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("includes members on every conversation returned by listConversationsForUser", async () => {
    const creator = await seedUser("Carol");
    const participant = await seedUser("Dave");
    await createConversation(db, r2, { type: "direct", creatorId: creator.id, participantUserIds: [participant.id] }, isOnline);

    const listed = await listConversationsForUser(db, r2, creator.id, isOnline);

    expect(listed.length).toBeGreaterThan(0);
    for (const conversation of listed) {
      expect(conversation.members.length).toBeGreaterThan(0);
    }
  });
});

// docs/ADR/0011-presence-and-receipts.md: the read-receipt relay's one validation query.
describe("getDirectConversationOtherMember", () => {
  it("returns the other member's id for a direct conversation", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const conversation = await createConversation(db, r2, { type: "direct", creatorId: alice.id, participantUserIds: [bob.id] }, isOnline);

    expect(await getDirectConversationOtherMember(db, conversation.id, alice.id)).toBe(bob.id);
    expect(await getDirectConversationOtherMember(db, conversation.id, bob.id)).toBe(alice.id);
  });

  it("returns null for a group conversation, even for an actual member", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const carol = await seedUser("Carol");
    const conversation = await createConversation(
      db,
      r2,
      { type: "group", creatorId: alice.id, participantUserIds: [bob.id, carol.id] },
      isOnline,
    );

    expect(await getDirectConversationOtherMember(db, conversation.id, alice.id)).toBeNull();
  });

  it("returns null for someone who isn't actually a member of the conversation", async () => {
    const alice = await seedUser("Alice");
    const bob = await seedUser("Bob");
    const stranger = await seedUser("Stranger");
    const conversation = await createConversation(db, r2, { type: "direct", creatorId: alice.id, participantUserIds: [bob.id] }, isOnline);

    expect(await getDirectConversationOtherMember(db, conversation.id, stranger.id)).toBeNull();
  });
});
