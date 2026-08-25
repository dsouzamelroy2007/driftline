import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeLocalStore } from "./node.js";
import { conversationCursors, outbox, timelineEntries } from "./schema.js";

// Validates the drizzle-orm/sqlite-proxy <-> node:sqlite wiring itself (row-shape, transactions,
// migrations) before anything is built on top — see docs/ADR/0006-local-store-engine.md's "spike
// first" note. Not a repository-level test; repository.test.ts covers the actual domain logic.
describe("node local store spike", () => {
  it("migrates, inserts, and reads back a row", async () => {
    const { db } = await createNodeLocalStore();

    await db.insert(conversationCursors).values({
      conversationId: "conv-1",
      lastSeenSeq: 1,
      updatedAt: new Date(),
    });

    const rows = await db.select().from(conversationCursors).where(eq(conversationCursors.conversationId, "conv-1"));
    expect(rows).toEqual([{ conversationId: "conv-1", lastSeenSeq: 1, updatedAt: expect.any(Date) }]);
  });

  it("supports .returning() on insert, including the autoincrement id", async () => {
    const { db } = await createNodeLocalStore();

    const [entry] = await db
      .insert(timelineEntries)
      .values({
        conversationId: "conv-1",
        kind: "message",
        envelopeId: "env-1",
        createdAt: new Date(),
      })
      .returning();

    expect(entry?.id).toBeTypeOf("number");
    expect(entry?.envelopeId).toBe("env-1");
  });

  it("commits a real transaction", async () => {
    const { db } = await createNodeLocalStore();

    await db.transaction(async (tx) => {
      await tx.insert(outbox).values({
        clientId: "client-1",
        conversationId: "conv-1",
        contentType: "text/plain",
        payload: "aGVsbG8=",
        createdAt: new Date(),
      });
    });

    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
  });

  it("rolls back a failed transaction", async () => {
    const { db } = await createNodeLocalStore();

    await expect(
      db.transaction(async (tx) => {
        await tx.insert(outbox).values({
          clientId: "client-2",
          conversationId: "conv-1",
          contentType: "text/plain",
          payload: "aGVsbG8=",
          createdAt: new Date(),
        });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(0);
  });

  it("two independent :memory: stores don't leak state into each other", async () => {
    const first = await createNodeLocalStore();
    await first.db.insert(conversationCursors).values({ conversationId: "c", lastSeenSeq: 0, updatedAt: new Date() });
    first.close();

    const second = await createNodeLocalStore();
    const rows = await second.db.select().from(conversationCursors);
    expect(rows).toHaveLength(0);
  });

  describe("reopening a persisted (file-backed) store", () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it("applies migrations idempotently and keeps prior data on a second open", async () => {
      // Regression test: applyMigrations previously re-ran every migration on every open because
      // its __migrations bookkeeping read the wrong row shape (see migrate.ts's comment) — this
      // was invisible against a fresh :memory: store (nothing to conflict with) and only surfaced
      // as a hard "table already exists" crash the moment a real persisted store was reopened,
      // caught by a live browser OPFS check, not this suite, until now.
      dir = mkdtempSync(join(tmpdir(), "driftline-local-store-"));
      const path = join(dir, "test.sqlite3");

      const first = await createNodeLocalStore(path);
      await first.db.insert(conversationCursors).values({ conversationId: "c", lastSeenSeq: 7, updatedAt: new Date() });
      first.close();

      const second = await createNodeLocalStore(path); // must not throw on re-applying migrations
      const rows = await second.db.select().from(conversationCursors);
      expect(rows).toEqual([{ conversationId: "c", lastSeenSeq: 7, updatedAt: expect.any(Date) }]);
      second.close();
    });
  });
});
