import { randomUUID } from "node:crypto";

import { createDbClient, users, type Db } from "@driftline/db";
import { beforeAll, describe, expect, it } from "vitest";

import { createConversation, listConversationsForUser } from "./conversations.service.js";

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

async function seedUser(displayName: string) {
  const [user] = await db.insert(users).values({ email: `${randomUUID()}@example.com`, displayName }).returning();
  return user!;
}

describe("conversations members", () => {
  it("attaches both members' display names to a new direct conversation", async () => {
    const creator = await seedUser("Alice");
    const participant = await seedUser("Bob");

    const conversation = await createConversation(db, {
      type: "direct",
      creatorId: creator.id,
      participantUserIds: [participant.id],
    });

    expect(conversation.members).toHaveLength(2);
    expect(conversation.members.map((member) => member.displayName).sort()).toEqual(["Alice", "Bob"]);
  });

  it("includes members on every conversation returned by listConversationsForUser", async () => {
    const creator = await seedUser("Carol");
    const participant = await seedUser("Dave");
    await createConversation(db, { type: "direct", creatorId: creator.id, participantUserIds: [participant.id] });

    const listed = await listConversationsForUser(db, creator.id);

    expect(listed.length).toBeGreaterThan(0);
    for (const conversation of listed) {
      expect(conversation.members.length).toBeGreaterThan(0);
    }
  });
});
