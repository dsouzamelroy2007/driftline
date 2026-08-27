import { randomUUID } from "node:crypto";

import { createDbClient, users, type Db } from "@driftline/db";
import type { S3Client } from "@aws-sdk/client-s3";
import { beforeAll, describe, expect, it } from "vitest";

import type { R2Context } from "../../plugins/app-context.js";
import { findUserByEmail, updateAvatar, updateDisplayName } from "./users.service.js";

function requireTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to run this suite — see retention.integration.test.ts.");
  }
  return url;
}

let db: Db;
// deleteR2Object is called best-effort and its failure is caught/logged, never thrown — so a client
// whose send() always rejects is enough to exercise the cleanup path without a real R2 bucket.
const r2: R2Context = {
  client: { send: () => Promise.reject(new Error("no real R2 in this test")) } as unknown as S3Client,
  bucket: "test-bucket",
};

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

describe("updateAvatar", () => {
  it("sets a self-uploaded avatar key with no previous avatar to clean up", async () => {
    const seeded = await seedUser(`${randomUUID()}@example.com`);

    const updated = await updateAvatar(db, r2, seeded.id, "avatars/abc/1");

    expect(updated.avatarUrl).toBe("avatars/abc/1");
  });

  it("replacing a self-uploaded avatar still succeeds even when the R2 cleanup call fails", async () => {
    const seeded = await seedUser(`${randomUUID()}@example.com`);
    await updateAvatar(db, r2, seeded.id, "avatars/abc/1");

    const updated = await updateAvatar(db, r2, seeded.id, "avatars/abc/2");

    expect(updated.avatarUrl).toBe("avatars/abc/2");
  });

  it("clearing an avatar to null never attempts to delete an external OAuth URL", async () => {
    const [seeded] = await db
      .insert(users)
      .values({ email: `${randomUUID()}@example.com`, displayName: "Original Name", avatarUrl: "https://github.com/avatar.png" })
      .returning();

    const updated = await updateAvatar(db, r2, seeded!.id, null);

    expect(updated.avatarUrl).toBeNull();
  });
});
