import {
  listOutboxEntries,
  reconcileOutboxEntry,
  setOutboxEntryStatus,
  type LocalStoreDb,
  type OutboxEntry,
} from "@driftline/local-store";

import type { MessageSendAck, SyncEngineSocket } from "./types.js";

const MESSAGE_SEND_TIMEOUT_MS = 10_000;

export interface OutboxSender {
  socket: SyncEngineSocket;
  selfUserId: string;
  selfDeviceId: string;
}

// Wraps the message:send ack-callback in a Promise with a timeout. Without the timeout, a
// connection that drops mid-send would leave this promise unsettled forever, wedging the
// EventQueue permanently (every later enqueued task — including the next reconnect's outbox
// flush — waits behind it). A late ack that arrives after the timeout is dropped; the outbox
// entry is already marked "failed" and will be resent with a new clientId on the next flush. This
// means an at-least-once, not exactly-once, send under that specific race — accepted here as a
// client-side simplification; a server-side idempotency key would be the real fix and is out of
// scope for a client-only phase.
function emitMessageSend(
  socket: SyncEngineSocket,
  entry: Pick<OutboxEntry, "clientId" | "conversationId" | "contentType" | "payload">,
): Promise<MessageSendAck> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ error: "timeout" });
    }, MESSAGE_SEND_TIMEOUT_MS);

    socket.emit(
      "message:send",
      {
        conversationId: entry.conversationId,
        clientId: entry.clientId,
        contentType: entry.contentType,
        payload: entry.payload,
      },
      (response: MessageSendAck) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(response);
      },
    );
  });
}

export async function sendOutboxEntry(store: LocalStoreDb, sender: OutboxSender, entry: OutboxEntry): Promise<void> {
  await setOutboxEntryStatus(store, entry.clientId, "sending");

  const response = await emitMessageSend(sender.socket, entry);

  if ("error" in response) {
    await setOutboxEntryStatus(store, entry.clientId, "failed");
    return;
  }

  await reconcileOutboxEntry(store, {
    clientId: entry.clientId,
    envelopeId: response.envelopeId,
    seq: response.seq,
    conversationId: entry.conversationId,
    senderId: sender.selfUserId,
    senderDeviceId: sender.selfDeviceId,
    contentType: entry.contentType,
    payload: entry.payload,
    // The sender's own file bytes, already available locally at compose time — no reason to
    // round-trip through upload+download of its own send (docs/ADR/0009-media-attachments.md).
    attachmentPayload: entry.attachmentPayload ?? undefined,
    createdAt: new Date(),
  });
}

// Retries every pending/failed entry, oldest first — not just "pending", since a "failed" entry
// (timeout, or a rejected send) deserves another attempt once we're back online rather than
// sitting there until Phase 5 builds a real retry UI on top of this.
export async function flushOutbox(store: LocalStoreDb, sender: OutboxSender): Promise<void> {
  const entries = await listOutboxEntries(store);
  for (const entry of entries) {
    await sendOutboxEntry(store, sender, entry);
  }
}
