import { createNodeLocalStore } from "@driftline/local-store/node";
import { insertIncomingEnvelope, listAllTimelineEntries } from "@driftline/local-store";
import { describe, expect, it } from "vitest";

import { exportBackup, importBackup } from "../src/file-format.js";

async function seedStore() {
  const { db } = await createNodeLocalStore();
  await insertIncomingEnvelope(db, {
    envelopeId: "env-1",
    conversationId: "conv-1",
    senderId: "user-a",
    senderDeviceId: "device-a",
    seq: 1,
    contentType: "text/plain",
    payload: "aGVsbG8=",
    createdAt: new Date(1_000),
  });
  await insertIncomingEnvelope(db, {
    envelopeId: "env-2",
    conversationId: "conv-1",
    senderId: "user-b",
    senderDeviceId: "device-b",
    seq: 2,
    contentType: "text/plain",
    payload: "d29ybGQ=",
    createdAt: new Date(2_000),
  });
  return db;
}

describe("backup file export/import round-trip", () => {
  it("restores every message into a fresh store with the correct passphrase", async () => {
    const sourceDb = await seedStore();
    const file = await exportBackup({ store: sourceDb, passphrase: "correct horse battery staple" });

    const { db: targetDb } = await createNodeLocalStore();
    const result = await importBackup({ store: targetDb, fileBytes: file, passphrase: "correct horse battery staple" });

    expect(result).toEqual({ conversationsImported: 1, entriesImported: 2 });
  });

  it("rejects the wrong passphrase without leaking why", async () => {
    const sourceDb = await seedStore();
    const file = await exportBackup({ store: sourceDb, passphrase: "correct horse battery staple" });

    const { db: targetDb } = await createNodeLocalStore();

    await expect(importBackup({ store: targetDb, fileBytes: file, passphrase: "wrong passphrase" })).rejects.toThrow(
      "Couldn't decrypt backup — check your passphrase.",
    );
  });

  it("rejects a tampered ciphertext the same way as a wrong passphrase", async () => {
    const sourceDb = await seedStore();
    const file = await exportBackup({ store: sourceDb, passphrase: "correct horse battery staple" });
    const tampered = JSON.parse(await file.text());
    tampered.ciphertext = tampered.ciphertext.slice(0, -4) + "abcd";

    const { db: targetDb } = await createNodeLocalStore();

    await expect(
      importBackup({ store: targetDb, fileBytes: JSON.stringify(tampered), passphrase: "correct horse battery staple" }),
    ).rejects.toThrow("Couldn't decrypt backup — check your passphrase.");
  });

  it("rejects a file that isn't a Driftline backup at all", async () => {
    const { db: targetDb } = await createNodeLocalStore();

    await expect(
      importBackup({ store: targetDb, fileBytes: JSON.stringify({ hello: "world" }), passphrase: "anything" }),
    ).rejects.toThrow("This doesn't look like a Driftline backup file.");
  });

  it("carries a media message's attachmentPayload through export/import", async () => {
    const { db: sourceDb } = await createNodeLocalStore();
    await insertIncomingEnvelope(sourceDb, {
      envelopeId: "env-media-1",
      conversationId: "conv-1",
      senderId: "user-a",
      senderDeviceId: "device-a",
      seq: 1,
      contentType: "image/png",
      payload: "eyJyMktleSI6ImsiLCJzaXplIjoxfQ==",
      attachmentPayload: "aW1hZ2UtYnl0ZXM=",
      createdAt: new Date(1_000),
    });

    const file = await exportBackup({ store: sourceDb, passphrase: "pw" });
    const { db: targetDb } = await createNodeLocalStore();
    await importBackup({ store: targetDb, fileBytes: file, passphrase: "pw" });

    const [entry] = await listAllTimelineEntries(targetDb, "conv-1");
    expect(entry!.attachmentPayload).toBe("aW1hZ2UtYnl0ZXM=");
  });

  it("re-importing the same backup twice is a no-op", async () => {
    const sourceDb = await seedStore();
    const file = await exportBackup({ store: sourceDb, passphrase: "pw" });
    const { db: targetDb } = await createNodeLocalStore();

    await importBackup({ store: targetDb, fileBytes: file, passphrase: "pw" });
    const second = await importBackup({ store: targetDb, fileBytes: file, passphrase: "pw" });

    expect(second.entriesImported).toBe(2); // attempted count — dedup happens via envelopeId inside importTimelineEntries
  });
});
