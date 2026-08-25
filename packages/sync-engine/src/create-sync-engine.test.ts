import { createNodeLocalStore, getConversationCursor, listOutboxEntries, listTimeline, type NodeLocalStore } from "@driftline/local-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSyncEngine, type SyncEngine } from "./create-sync-engine.js";
import { FakeSocket } from "./test/fake-socket.js";

function wireEnvelope(overrides: { seq: number; conversationId?: string; id?: string }) {
  return {
    id: overrides.id ?? `env-${overrides.seq}-${Math.random().toString(36).slice(2)}`,
    conversationId: overrides.conversationId ?? "conv-1",
    senderId: "user-b",
    senderDeviceId: "device-b",
    seq: overrides.seq,
    contentType: "text/plain",
    payload: "aGVsbG8=",
    createdAt: new Date().toISOString(),
  };
}

describe("createSyncEngine", () => {
  let store: NodeLocalStore;
  let socket: FakeSocket;
  let engine: SyncEngine;

  beforeEach(async () => {
    store = await createNodeLocalStore();
    socket = new FakeSocket();
    engine = createSyncEngine({ socket, store: store.db, selfUserId: "user-a", selfDeviceId: "device-a" });
  });

  afterEach(() => {
    engine.dispose();
  });

  it("inserts a history_start marker and the message on first delivery, then acks", async () => {
    const envelope = wireEnvelope({ seq: 5 });
    socket.triggerEnvelopeDeliver(envelope);
    await vi.waitFor(async () => expect(await getConversationCursor(store.db, "conv-1")).toBe(5));

    const timeline = await listTimeline(store.db, "conv-1");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "history_start"]);
    expect(socket.outgoingEvents).toContainEqual({ event: "envelope:ack", args: [{ envelopeId: envelope.id }] });
  });

  it("inserts a gap marker on a sequence jump", async () => {
    socket.triggerEnvelopeDeliver(wireEnvelope({ seq: 1 }));
    await vi.waitFor(async () => expect(await getConversationCursor(store.db, "conv-1")).toBe(1));

    socket.triggerEnvelopeDeliver(wireEnvelope({ seq: 4 }));
    await vi.waitFor(async () => expect(await getConversationCursor(store.db, "conv-1")).toBe(4));

    const timeline = await listTimeline(store.db, "conv-1");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "gap", "message", "history_start"]);
  });

  it("inserts no marker for contiguous delivery", async () => {
    socket.triggerEnvelopeDeliver(wireEnvelope({ seq: 1 }));
    await vi.waitFor(async () => expect(await getConversationCursor(store.db, "conv-1")).toBe(1));
    socket.triggerEnvelopeDeliver(wireEnvelope({ seq: 2 }));
    await vi.waitFor(async () => expect(await getConversationCursor(store.db, "conv-1")).toBe(2));

    const timeline = await listTimeline(store.db, "conv-1");
    expect(timeline.map((e) => e.kind)).toEqual(["message", "message", "history_start"]);
  });

  it("still acks a duplicate redelivery, but writes nothing new", async () => {
    const envelope = wireEnvelope({ seq: 1, id: "env-fixed" });
    socket.triggerEnvelopeDeliver(envelope);
    await vi.waitFor(async () => expect((await listTimeline(store.db, "conv-1")).length).toBe(2));

    socket.outgoingEvents = [];
    socket.triggerEnvelopeDeliver(envelope); // redelivered
    await vi.waitFor(() =>
      expect(socket.outgoingEvents).toContainEqual({ event: "envelope:ack", args: [{ envelopeId: "env-fixed" }] }),
    );

    const timeline = await listTimeline(store.db, "conv-1");
    expect(timeline).toHaveLength(2); // unchanged
  });

  it("never acks when the durable write fails", async () => {
    const failure = new Error("simulated write failure");
    const transactionSpy = vi.spyOn(store.db, "transaction").mockRejectedValueOnce(failure);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const envelope = wireEnvelope({ seq: 1 });
    socket.triggerEnvelopeDeliver(envelope);
    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());

    expect(socket.outgoingEvents.find((e) => e.event === "envelope:ack")).toBeUndefined();
    transactionSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  it("fans dormancy:return out to every known conversation", async () => {
    socket.triggerEnvelopeDeliver(wireEnvelope({ seq: 1, conversationId: "conv-a" }));
    socket.triggerEnvelopeDeliver(wireEnvelope({ seq: 1, conversationId: "conv-b" }));
    await vi.waitFor(async () => expect(await getConversationCursor(store.db, "conv-b")).toBe(1));

    socket.triggerDormancyReturn();
    await vi.waitFor(async () => {
      const timeline = await listTimeline(store.db, "conv-a");
      expect(timeline.map((e) => e.kind)).toContain("dormancy_return");
    });
    const timelineB = await listTimeline(store.db, "conv-b");
    expect(timelineB.map((e) => e.kind)).toContain("dormancy_return");
  });

  it("sends immediately when connected", async () => {
    socket.connected = true;
    socket.onMessageSend(() => ({ clientId: "irrelevant", envelopeId: "env-server-1", seq: 1 }));

    await engine.sendMessage("conv-1", "text/plain", "aGk=");

    expect(await listOutboxEntries(store.db)).toHaveLength(0);
    const timeline = await listTimeline(store.db, "conv-1");
    expect(timeline.find((e) => e.kind === "message")).toMatchObject({ envelopeId: "env-server-1" });
  });

  it("queues while disconnected and flushes on connect", async () => {
    socket.connected = false;
    await engine.sendMessage("conv-1", "text/plain", "aGk=");
    expect(await listOutboxEntries(store.db)).toHaveLength(1);

    socket.onMessageSend(() => ({ clientId: "irrelevant", envelopeId: "env-server-2", seq: 1 }));
    socket.triggerConnect();

    await vi.waitFor(async () => expect(await listOutboxEntries(store.db)).toHaveLength(0));
    const timeline = await listTimeline(store.db, "conv-1");
    expect(timeline.find((e) => e.kind === "message")).toMatchObject({ envelopeId: "env-server-2" });
  });

  it("marks an outbox entry failed on an error response, without wedging later sends", async () => {
    socket.connected = true;
    socket.onMessageSend(() => ({ error: "not a member of this conversation" }));

    await engine.sendMessage("conv-1", "text/plain", "aGk=");

    const entries = await listOutboxEntries(store.db);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe("failed");
  });
});
