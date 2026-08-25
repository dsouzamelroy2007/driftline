import { randomUUID } from "node:crypto";

import { createDbClient, users, type Db } from "@driftline/db";
import { beforeAll, describe, expect, it } from "vitest";

import { findUserByEmail, updateDisplayName } from "./users.service.js";

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

async function seedUser(email: string) {
  const [user] = await db.insert(users).values({ email, displayName: "Original Name" }).returning();
  return user!;
}

describe("findUserByEmail", () => {
  it("finds a user by exact email", async () => {
    const email = `${randomUUID()}@example.com`;
    const seeded = await seedUser(email);

    const found = await findUserByEmail(db, email);

    expect(found?.id).toBe(seeded.id);
  });

  it("returns undefined for an unknown email", async () => {
    const found = await findUserByEmail(db, `${randomUUID()}@example.com`);
    expect(found).toBeUndefined();
  });
});

describe("updateDisplayName", () => {
  it("persists the new display name", async () => {
    const seeded = await seedUser(`${randomUUID()}@example.com`);

    const updated = await updateDisplayName(db, seeded.id, "New Name");

    expect(updated.displayName).toBe("New Name");
  });
});
