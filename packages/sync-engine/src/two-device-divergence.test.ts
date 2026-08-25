import { createNodeLocalStore, getConversationCursor, listTimeline } from "@driftline/local-store";
import { describe, expect, it, vi } from "vitest";

import { createSyncEngine } from "./create-sync-engine.js";
import { FakeSocket } from "./test/fake-socket.js";

// ADR-0003's explicit, named goal: "two devices of the same user are allowed to be
// self-consistent but divergent... tested for explicitly in Phase 4, not a bug to eliminate."
// There is no shared state between devices to reconcile — each device's local store plus its own
// EnvelopeTarget drain *is* its state (ADR-0003 consequences). This test proves two independent
// stores fed different delivery streams for the same conversation each end up internally
// consistent, without asserting they converge to the same content — because they shouldn't.
describe("two-device divergence", () => {
  it("device A (fully caught up) and device B (missed the first envelope) both stay self-consistent", async () => {
    const deviceA = await createNodeLocalStore();
    const deviceB = await createNodeLocalStore();
    const socketA = new FakeSocket();
    const socketB = new FakeSocket();
    const engineA = createSyncEngine({ socket: socketA, store: deviceA.db, selfUserId: "user-1", selfDeviceId: "device-a" });
    const engineB = createSyncEngine({ socket: socketB, store: deviceB.db, selfUserId: "user-1", selfDeviceId: "device-b" });

    const conversationId = "conv-shared";
    const envelope = (seq: number) => ({
      id: `env-${seq}`,
      conversationId,
      senderId: "user-2",
      senderDeviceId: "device-x",
      seq,
      contentType: "text/plain",
      payload: `payload-${seq}`,
      createdAt: new Date().toISOString(),
    });

    // Device A received every envelope from the start.
    socketA.triggerEnvelopeDeliver(envelope(1));
    socketA.triggerEnvelopeDeliver(envelope(2));
    socketA.triggerEnvelopeDeliver(envelope(3));

    // Device B only came online (or was already dormant/excluded) starting from seq 2 — seq 1
    // was already purged before it could be delivered here. This is the ordinary, expected case
    // ADR-0003 §4 describes for a device with "nothing to gap-detect against": its first-ever
    // envelope for this conversation is a history_start, never a gap, no matter what seq it is.
    socketB.triggerEnvelopeDeliver(envelope(2));
    socketB.triggerEnvelopeDeliver(envelope(3));

    await vi.waitFor(async () => expect(await getConversationCursor(deviceA.db, conversationId)).toBe(3));
    await vi.waitFor(async () => expect(await getConversationCursor(deviceB.db, conversationId)).toBe(3));

    const timelineA = await listTimeline(deviceA.db, conversationId);
    const timelineB = await listTimeline(deviceB.db, conversationId);

    // Device A: fully contiguous, no gap ever detected.
    expect(timelineA.map((e) => e.kind).reverse()).toEqual(["history_start", "message", "message", "message"]);
    expect(timelineA.some((e) => e.kind === "gap")).toBe(false);

    // Device B: only has 2 messages, its own history_start (not a gap) at seq 2 — genuinely
    // divergent content from device A, and that's correct, not corruption.
    expect(timelineB.map((e) => e.kind).reverse()).toEqual(["history_start", "message", "message"]);
    expect(timelineB.some((e) => e.kind === "gap")).toBe(false);
    expect(timelineA.filter((e) => e.kind === "message")).toHaveLength(3);
    expect(timelineB.filter((e) => e.kind === "message")).toHaveLength(2);

    engineA.dispose();
    engineB.dispose();
  });
});
