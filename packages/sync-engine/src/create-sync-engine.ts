import { appendOutboxEntry, insertDormancyReturnMarkers, insertIncomingEnvelope, type LocalStoreDb } from "@driftline/local-store";

import { downloadAttachment } from "./attachment-download.js";
import { EventQueue } from "./event-queue.js";
import { flushOutbox, sendOutboxEntry } from "./outbox.js";
import type { SyncEngineSocket, WireEnvelope } from "./types.js";

export interface CreateSyncEngineOptions {
  socket: SyncEngineSocket;
  store: LocalStoreDb;
  /** This device's own identity — needed to attribute its own sent messages in the timeline,
   * since the server never echoes envelope:deliver back to the sending device. */
  selfUserId: string;
  selfDeviceId: string;
}

export interface SyncEngine {
  /** Queues a message for sending — local-first: the outbox row lands immediately, then sends
   * right away if connected or on the next reconnect otherwise. Resolves once the send attempt
   * (success or failure) completes, not just once it's queued. `attachmentPayload` is the sender's
   * own already-local file bytes for a media message (docs/ADR/0009-media-attachments.md) — never
   * sent to the server, only cached locally so the optimistic bubble can render immediately. */
  sendMessage: (conversationId: string, contentType: string, payload: string, attachmentPayload?: string) => Promise<void>;
  dispose: () => void;
}

export function createSyncEngine(options: CreateSyncEngineOptions): SyncEngine {
  const { socket, store, selfUserId, selfDeviceId } = options;
  const queue = new EventQueue();
  const sender = { socket, selfUserId, selfDeviceId };

  async function handleEnvelopeDeliver(wireEnvelope: WireEnvelope): Promise<void> {
    let attachmentPayload: string | undefined;
    if (wireEnvelope.attachmentDownloadUrl) {
      attachmentPayload = await downloadAttachment(wireEnvelope.attachmentDownloadUrl);
      if (attachmentPayload === undefined) {
        // Every retry failed — do NOT insert or ack (docs/ADR/0009-media-attachments.md). The
        // target stays pending server-side and this envelope (with a fresh download URL) is
        // redelivered on this device's next reconnect.
        return;
      }
    }

    await insertIncomingEnvelope(store, {
      envelopeId: wireEnvelope.id,
      conversationId: wireEnvelope.conversationId,
      senderId: wireEnvelope.senderId,
      senderDeviceId: wireEnvelope.senderDeviceId,
      seq: wireEnvelope.seq,
      contentType: wireEnvelope.contentType,
      payload: wireEnvelope.payload,
      attachmentPayload,
      createdAt: new Date(wireEnvelope.createdAt),
    });
    // Ack only after the durable local write above commits — never inferred from the socket event
    // itself (docs/REALTIME_PROTOCOL.md's envelope:ack contract). For a media message this is the
    // load-bearing step: once acked, the server may purge the R2 object at any time, so the
    // attachment bytes must already be durably saved locally before this fires.
    socket.emit("envelope:ack", { envelopeId: wireEnvelope.id });
  }

  async function handleDormancyReturn(): Promise<void> {
    await insertDormancyReturnMarkers(store, new Date());
  }

  async function handleConnect(): Promise<void> {
    await flushOutbox(store, sender);
  }

  // These are fire-and-forget event handlers — there's no caller to propagate a rejection to, but
  // an unhandled one would still surface as an unhandled-rejection warning/crash, so it's reported
  // instead of silently discarded (`void queue.enqueue(...)` alone would drop it entirely).
  function reportHandlerError(source: string, error: unknown): void {
    console.error(`sync-engine: ${source} handler failed`, error);
  }

  const onEnvelopeDeliver = (wireEnvelope: WireEnvelope) => {
    queue.enqueue(() => handleEnvelopeDeliver(wireEnvelope)).catch((error: unknown) => reportHandlerError("envelope:deliver", error));
  };
  const onDormancyReturn = () => {
    queue.enqueue(() => handleDormancyReturn()).catch((error: unknown) => reportHandlerError("dormancy:return", error));
  };
  const onConnect = () => {
    queue.enqueue(() => handleConnect()).catch((error: unknown) => reportHandlerError("connect", error));
  };

  socket.on("envelope:deliver", onEnvelopeDeliver as (...args: never[]) => void);
  socket.on("dormancy:return", onDormancyReturn);
  socket.on("connect", onConnect);

  async function sendMessage(conversationId: string, contentType: string, payload: string, attachmentPayload?: string): Promise<void> {
    const clientId = crypto.randomUUID();
    const entry = { clientId, conversationId, contentType, payload, attachmentPayload, createdAt: new Date() };

    await queue.enqueue(async () => {
      await appendOutboxEntry(store, entry);
      if (socket.connected) {
        await sendOutboxEntry(store, sender, { ...entry, attachmentPayload: entry.attachmentPayload ?? null, status: "pending" as const });
      }
    });
  }

  function dispose(): void {
    socket.off("envelope:deliver", onEnvelopeDeliver as (...args: never[]) => void);
    socket.off("dormancy:return", onDormancyReturn);
    socket.off("connect", onConnect);
  }

  return { sendMessage, dispose };
}
