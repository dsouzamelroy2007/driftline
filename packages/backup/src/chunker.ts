import type { BackupConversation, BackupEntry, BackupPayload } from "./serialize.js";

// The device-linking P2P wire format (docs/BACKUP_FORMAT.md): a flat item stream rather than the
// file format's per-conversation grouping, so chunk boundaries never need to respect conversation
// boundaries. No passphrase/encryption at this layer — the WebRTC data channel is already
// DTLS-encrypted end-to-end; the file format's AES-GCM envelope is deliberately not reused here.
export interface FlatBackupItem {
  conversationId: string;
  cursorSeq: number;
  entry: BackupEntry;
}

export type ChunkMessage = { type: "start"; totalItems: number } | { type: "chunk"; items: FlatBackupItem[] } | { type: "done" };

const DEFAULT_CHUNK_SIZE = 200;

function flattenBackupPayload(payload: BackupPayload): FlatBackupItem[] {
  const items: FlatBackupItem[] = [];
  for (const conversation of payload.conversations) {
    for (const entry of conversation.entries) {
      items.push({ conversationId: conversation.conversationId, cursorSeq: conversation.cursorSeq, entry });
    }
  }
  return items;
}

export function chunkBackupPayload(payload: BackupPayload, chunkSize = DEFAULT_CHUNK_SIZE): ChunkMessage[] {
  const items = flattenBackupPayload(payload);
  const messages: ChunkMessage[] = [{ type: "start", totalItems: items.length }];
  for (let i = 0; i < items.length; i += chunkSize) {
    messages.push({ type: "chunk", items: items.slice(i, i + chunkSize) });
  }
  messages.push({ type: "done" });
  return messages;
}

export interface ChunkReassembler {
  push: (message: ChunkMessage) => void;
  isDone: () => boolean;
  totalItems: () => number | undefined;
  receivedCount: () => number;
  toBackupPayload: () => BackupPayload;
}

// Reassembles regardless of how items are distributed across chunks (a conversation's items can
// span multiple chunk messages, or be interleaved with another conversation's) — grouping happens
// once at the end, keyed by conversationId, taking the max cursorSeq seen per conversation (every
// item for a conversation carries the same cursorSeq, so max is just defensive).
export function createChunkReassembler(): ChunkReassembler {
  let total: number | undefined;
  let done = false;
  const items: FlatBackupItem[] = [];

  return {
    push(message) {
      if (message.type === "start") {
        total = message.totalItems;
      } else if (message.type === "chunk") {
        items.push(...message.items);
      } else {
        done = true;
      }
    },
    isDone: () => done,
    totalItems: () => total,
    receivedCount: () => items.length,
    toBackupPayload(): BackupPayload {
      const byConversation = new Map<string, BackupConversation>();
      for (const item of items) {
        const conversation = byConversation.get(item.conversationId) ?? {
          conversationId: item.conversationId,
          cursorSeq: item.cursorSeq,
          entries: [],
        };
        conversation.cursorSeq = Math.max(conversation.cursorSeq, item.cursorSeq);
        conversation.entries.push(item.entry);
        byConversation.set(item.conversationId, conversation);
      }
      return { conversations: [...byConversation.values()] };
    },
  };
}
