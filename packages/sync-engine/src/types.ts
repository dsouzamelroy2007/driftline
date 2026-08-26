// The minimal subset of socket.io-client's Socket that sync-engine actually uses. Depending on
// this instead of the real Socket type keeps the fake used in tests trivial to write and keeps
// this package's public surface honest about what it needs.
export interface SyncEngineSocket {
  readonly connected: boolean;
  on(event: string, handler: (...args: never[]) => void): void;
  off(event: string, handler?: (...args: never[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

// The over-the-wire shape from docs/REALTIME_PROTOCOL.md's envelope:deliver event. createdAt
// arrives as an ISO string (Socket.IO does not revive Date instances on the wire).
export interface WireEnvelope {
  id: string;
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  seq: number;
  contentType: string;
  payload: string;
  createdAt: string;
  // Present only for media messages (docs/ADR/0009-media-attachments.md) — a presigned R2 GET URL,
  // minted fresh by the server at delivery time (both live delivery and reconnect drain), short-TTL.
  attachmentDownloadUrl?: string;
}

export type MessageSendAck =
  | { clientId: string; envelopeId: string; seq: number }
  | { error: string };
