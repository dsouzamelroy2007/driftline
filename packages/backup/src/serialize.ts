import {
  getConversationCursor,
  importTimelineEntries,
  listAllTimelineEntries,
  listKnownConversationIds,
  type ImportTimelineEntriesResult,
  type LocalStoreDb,
} from "@driftline/local-store";

export type { ImportTimelineEntriesResult };

// The plaintext model shared by both transports (docs/BACKUP_FORMAT.md): the encrypted backup file
// wraps this whole shape in an AES-GCM envelope (crypto.ts/file-format.ts); the device-linking P2P
// transfer streams the same shape's entries unencrypted-at-this-layer over an already-DTLS-encrypted
// WebRTC data channel (chunker.ts). createdAt is epoch milliseconds, not a Date, so this is directly
// JSON-serializable.
export interface BackupEntry {
  envelopeId: string;
  senderId: string;
  senderDeviceId: string;
  seq: number;
  contentType: string;
  payload: string;
  /** A media message's locally-cached attachment bytes (docs/ADR/0009-media-attachments.md) — only
   * present when this device downloaded/kept them; not every device that has the message will have
   * them past retention purge, so this stays optional on both write and read. */
  attachmentPayload?: string;
  createdAt: number;
}

export interface BackupConversation {
  conversationId: string;
  cursorSeq: number;
  entries: BackupEntry[];
}

export interface BackupPayload {
  conversations: BackupConversation[];
}

// Reads this device's entire local-store history — every known conversation's full message
// timeline and cursor, oldest-first — for export or for handing to a newly-linked device.
// message-kind timeline entries always carry envelopeId/senderId/senderDeviceId/seq/contentType/
// payload (only gap/history_start/dormancy_return markers omit them), so the cast below is safe.
export async function collectBackupPayload(db: LocalStoreDb): Promise<BackupPayload> {
  const conversationIds = await listKnownConversationIds(db);

  const conversations: BackupConversation[] = [];
  for (const conversationId of conversationIds) {
    const cursorSeq = await getConversationCursor(db, conversationId);
    if (cursorSeq === undefined) continue;

    const entries = await listAllTimelineEntries(db, conversationId);
    conversations.push({
      conversationId,
      cursorSeq,
      entries: entries.map((entry) => ({
        envelopeId: entry.envelopeId!,
        senderId: entry.senderId!,
        senderDeviceId: entry.senderDeviceId!,
        seq: entry.seq!,
        contentType: entry.contentType!,
        payload: entry.payload!,
        attachmentPayload: entry.attachmentPayload ?? undefined,
        createdAt: entry.createdAt.getTime(),
      })),
    });
  }

  return { conversations };
}

// The write side of both backup import and a completed device-linking transfer — delegates
// straight to local-store's importTimelineEntries (see its doc comment for ordering/dedup/cursor
// semantics), just translating epoch-ms back to Date.
export async function applyBackupPayload(db: LocalStoreDb, payload: BackupPayload): Promise<ImportTimelineEntriesResult> {
  return importTimelineEntries(
    db,
    payload.conversations.map((conversation) => ({
      conversationId: conversation.conversationId,
      cursorSeq: conversation.cursorSeq,
      entries: conversation.entries.map((entry) => ({
        envelopeId: entry.envelopeId,
        senderId: entry.senderId,
        senderDeviceId: entry.senderDeviceId,
        seq: entry.seq,
        contentType: entry.contentType,
        payload: entry.payload,
        attachmentPayload: entry.attachmentPayload,
        createdAt: new Date(entry.createdAt),
      })),
    })),
  );
}
