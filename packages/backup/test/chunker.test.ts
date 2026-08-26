import { describe, expect, it } from "vitest";

import { chunkBackupPayload, createChunkReassembler } from "../src/chunker.js";
import type { BackupPayload } from "../src/serialize.js";

function payload(): BackupPayload {
  return {
    conversations: [
      {
        conversationId: "conv-1",
        cursorSeq: 2,
        entries: [
          { envelopeId: "e1", senderId: "u1", senderDeviceId: "d1", seq: 1, contentType: "text/plain", payload: "aGk=", createdAt: 1 },
          { envelopeId: "e2", senderId: "u1", senderDeviceId: "d1", seq: 2, contentType: "text/plain", payload: "aGk=", createdAt: 2 },
        ],
      },
      {
        conversationId: "conv-2",
        cursorSeq: 1,
        entries: [
          { envelopeId: "e3", senderId: "u2", senderDeviceId: "d2", seq: 1, contentType: "text/plain", payload: "aGk=", createdAt: 3 },
        ],
      },
    ],
  };
}

describe("chunkBackupPayload / createChunkReassembler", () => {
  it("splits into chunks bounded by chunkSize, framed with start/done", () => {
    const messages = chunkBackupPayload(payload(), 2);

    expect(messages[0]).toEqual({ type: "start", totalItems: 3 });
    expect(messages.at(-1)).toEqual({ type: "done" });
    const chunkMessages = messages.filter((m) => m.type === "chunk");
    expect(chunkMessages).toHaveLength(2); // 3 items, chunkSize 2 -> [2, 1]
  });

  it("reassembles a chunked stream back into the original payload, grouped by conversation", () => {
    const original = payload();
    const messages = chunkBackupPayload(original, 2);

    const reassembler = createChunkReassembler();
    for (const message of messages) reassembler.push(message);

    expect(reassembler.isDone()).toBe(true);
    expect(reassembler.totalItems()).toBe(3);
    expect(reassembler.receivedCount()).toBe(3);

    const rebuilt = reassembler.toBackupPayload();
    expect(rebuilt.conversations.map((c) => c.conversationId).sort()).toEqual(["conv-1", "conv-2"]);
    const conv1 = rebuilt.conversations.find((c) => c.conversationId === "conv-1")!;
    expect(conv1.cursorSeq).toBe(2);
    expect(conv1.entries.map((e) => e.seq)).toEqual([1, 2]);
  });

  it("reassembles correctly even when chunk boundaries split a conversation's items across messages", () => {
    const messages = chunkBackupPayload(payload(), 1); // every chunk has exactly one item

    const reassembler = createChunkReassembler();
    for (const message of messages) reassembler.push(message);

    const rebuilt = reassembler.toBackupPayload();
    expect(rebuilt.conversations.reduce((sum, c) => sum + c.entries.length, 0)).toBe(3);
  });

  it("is not done until a done message arrives", () => {
    const reassembler = createChunkReassembler();
    reassembler.push({ type: "start", totalItems: 1 });
    reassembler.push({ type: "chunk", items: [] });

    expect(reassembler.isDone()).toBe(false);
  });
});
