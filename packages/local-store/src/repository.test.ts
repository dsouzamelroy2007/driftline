import { describe, expect, it } from "vitest";

import { createNodeLocalStore } from "./node.js";
import {
  appendOutboxEntry,
  countMessagesAfter,
  getConversationCursor,
  importTimelineEntries,
  insertDormancyReturnMarkers,
  insertIncomingEnvelope,
  listAllTimelineEntries,
  listKnownConversationIds,
  listOutboxEntries,
  listTimeline,
  reconcileOutboxEntry,
  type ImportConversationInput,
  type IncomingEnvelope,
} from "./repository.js";

function envelope(overrides: Partial<IncomingEnvelope> & { seq: number }): IncomingEnvelope {
  return {
    envelopeId: `env-${overrides.seq}-${Math.random().toString(36).slice(2)}`,
    conversationId: "conv-1",
    senderId: "user-b",
    senderDeviceId: "device-b",
    contentType: "text/plain",
    payload: "aGVsbG8=",
    createdAt: new Date(),
    ...overrides,
  };
}

describe("insertIncomingEnvelope", () => {
  it("classifies the first envelope for a conversation as history_start", async () => {
    const { db } = await createNodeLocalStore();

    const result = await insertIncomingEnvelope(db, envelope({ seq: 5 }));

    expect(result.classification).toBe("history_start");
    const timeline = await listTimeline(db, "conv-1");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "history_start"]);
    expect(await getConversationCursor(db, "conv-1")).toBe(5);
  });

  it("classifies a contiguous envelope as ok with no marker", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ seq: 1 }));

    const result = await insertIncomingEnvelope(db, envelope({ seq: 2 }));

    expect(result.classification).toBe("ok");
    const timeline = await listTimeline(db, "conv-1");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "message", "history_start"]);
  });

  it("inserts a gap marker when seq jumps by more than 1", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ seq: 1 }));

    const result = await insertIncomingEnvelope(db, envelope({ seq: 5 }));

    expect(result.classification).toBe("gap");
    const timeline = await listTimeline(db, "conv-1");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "gap", "message", "history_start"]);
    const gapEntry = timeline.find((e) => e.kind === "gap");
    expect(gapEntry).toMatchObject({ gapFromSeq: 2, gapToSeq: 4 });
    expect(await getConversationCursor(db, "conv-1")).toBe(5);
  });

  it("treats a redelivered envelope (seq <= cursor) as a pure no-op duplicate", async () => {
    const { db } = await createNodeLocalStore();
    const first = envelope({ seq: 1, envelopeId: "env-fixed" });
    await insertIncomingEnvelope(db, first);
    await insertIncomingEnvelope(db, envelope({ seq: 2 }));

    const result = await insertIncomingEnvelope(db, first); // redelivered

    expect(result.classification).toBe("duplicate");
    const timeline = await listTimeline(db, "conv-1");
    expect(timeline).toHaveLength(3); // history_start + seq 1 + seq 2 — the redelivery added nothing
    expect(await getConversationCursor(db, "conv-1")).toBe(2); // unchanged
  });
});

describe("countMessagesAfter", () => {
  it("counts only messages, not markers, strictly after the given id", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ seq: 1 })); // history_start + message
    await insertIncomingEnvelope(db, envelope({ seq: 2 }));
    await insertIncomingEnvelope(db, envelope({ seq: 5 })); // gap + message

    expect(await countMessagesAfter(db, "conv-1", 0)).toBe(3);

    const timeline = await listTimeline(db, "conv-1");
    const firstMessageId = timeline.find((e) => e.kind === "message" && e.seq === 1)!.id;
    expect(await countMessagesAfter(db, "conv-1", firstMessageId)).toBe(2);
  });

  it("is zero for an unknown conversation", async () => {
    const { db } = await createNodeLocalStore();
    expect(await countMessagesAfter(db, "conv-none", 0)).toBe(0);
  });
});

describe("dormancy:return fan-out", () => {
  it("inserts a marker into every known conversation, skipping conversations with no cursor", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ seq: 1, conversationId: "conv-a" }));
    await insertIncomingEnvelope(db, envelope({ seq: 1, conversationId: "conv-b" }));

    await insertDormancyReturnMarkers(db, new Date());

    const known = await listKnownConversationIds(db);
    expect(known.sort()).toEqual(["conv-a", "conv-b"]);
    for (const conversationId of known) {
      const timeline = await listTimeline(db, conversationId);
      expect(timeline.map((e) => e.kind)).toContain("dormancy_return");
    }
  });

  it("is a no-op when no conversations are known yet", async () => {
    const { db } = await createNodeLocalStore();
    await expect(insertDormancyReturnMarkers(db, new Date())).resolves.toBeUndefined();
  });
});

describe("outbox", () => {
  it("appends a pending entry that reconcile then removes and replaces with a timeline message", async () => {
    const { db } = await createNodeLocalStore();
    await appendOutboxEntry(db, {
      clientId: "client-1",
      conversationId: "conv-1",
      contentType: "text/plain",
      payload: "aGk=",
      createdAt: new Date(),
    });
    expect(await listOutboxEntries(db)).toHaveLength(1);

    await reconcileOutboxEntry(db, {
      clientId: "client-1",
      envelopeId: "env-server-1",
      seq: 1,
      conversationId: "conv-1",
      senderId: "user-a",
      senderDeviceId: "device-a",
      contentType: "text/plain",
      payload: "aGk=",
      createdAt: new Date(),
    });

    expect(await listOutboxEntries(db)).toHaveLength(0);
    const timeline = await listTimeline(db, "conv-1");
    // history_start + message — this is also the first-ever entry in the conversation, and that's
    // true whether the first entry arrives via envelope:deliver or this device's own send.
    expect(timeline).toHaveLength(2);
    const messageEntry = timeline.find((e) => e.kind === "message");
    expect(messageEntry).toMatchObject({ envelopeId: "env-server-1" });
    expect(await getConversationCursor(db, "conv-1")).toBe(1);
  });

  it("a later envelope from someone else is contiguous after this device's own send advanced the cursor", async () => {
    const { db } = await createNodeLocalStore();
    await reconcileOutboxEntry(db, {
      clientId: "client-1",
      envelopeId: "env-server-1",
      seq: 1,
      conversationId: "conv-1",
      senderId: "user-a",
      senderDeviceId: "device-a",
      contentType: "text/plain",
      payload: "aGk=",
      createdAt: new Date(),
    });

    const result = await insertIncomingEnvelope(db, envelope({ seq: 2, conversationId: "conv-1" }));

    expect(result.classification).toBe("ok"); // not "gap" — the sender's own cursor advance made this contiguous
  });
});

function importConversation(overrides: Partial<ImportConversationInput> = {}): ImportConversationInput {
  return {
    conversationId: "conv-imported",
    cursorSeq: 3,
    entries: [1, 2, 3].map((seq) => ({
      envelopeId: `env-import-${seq}`,
      senderId: "user-b",
      senderDeviceId: "device-b",
      seq,
      contentType: "text/plain",
      payload: "aGVsbG8=",
      createdAt: new Date(1_000 * seq),
    })),
    ...overrides,
  };
}

describe("importTimelineEntries", () => {
  it("bulk-writes entries into an empty conversation and advances the cursor to cursorSeq", async () => {
    const { db } = await createNodeLocalStore();

    const result = await importTimelineEntries(db, [importConversation()]);

    expect(result).toEqual({ conversationsImported: 1, entriesImported: 3 });
    const timeline = await listAllTimelineEntries(db, "conv-imported");
    expect(timeline.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(timeline.every((e) => e.kind === "message")).toBe(true);
    expect(await getConversationCursor(db, "conv-imported")).toBe(3);
  });

  it("re-importing the same backup is a no-op (dedup via envelopeId)", async () => {
    const { db } = await createNodeLocalStore();
    await importTimelineEntries(db, [importConversation()]);

    await importTimelineEntries(db, [importConversation()]);

    const timeline = await listAllTimelineEntries(db, "conv-imported");
    expect(timeline).toHaveLength(3);
  });

  it("never regresses the cursor when importing an older backup onto newer live-synced history", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ conversationId: "conv-imported", seq: 10 }));

    await importTimelineEntries(db, [importConversation({ cursorSeq: 3 })]);

    expect(await getConversationCursor(db, "conv-imported")).toBe(10);
  });

  it("advances the cursor forward when the imported history is newer than what's known", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ conversationId: "conv-imported", seq: 1 }));

    await importTimelineEntries(db, [importConversation({ cursorSeq: 3 })]);

    expect(await getConversationCursor(db, "conv-imported")).toBe(3);
  });

  it("does not touch the outbox table", async () => {
    const { db } = await createNodeLocalStore();
    await appendOutboxEntry(db, {
      clientId: "client-1",
      conversationId: "conv-imported",
      contentType: "text/plain",
      payload: "aGk=",
      createdAt: new Date(),
    });

    await importTimelineEntries(db, [importConversation()]);

    expect(await listOutboxEntries(db)).toHaveLength(1);
  });
});

describe("listAllTimelineEntries", () => {
  it("returns only message-kind entries, oldest-first, unpaginated", async () => {
    const { db } = await createNodeLocalStore();
    await insertIncomingEnvelope(db, envelope({ conversationId: "conv-1", seq: 1 })); // history_start + message
    await insertIncomingEnvelope(db, envelope({ conversationId: "conv-1", seq: 5 })); // gap + message

    const entries = await listAllTimelineEntries(db, "conv-1");

    expect(entries.map((e) => e.kind)).toEqual(["message", "message"]);
    expect(entries.map((e) => e.seq)).toEqual([1, 5]);
  });
});
