import type { S3Client } from "@aws-sdk/client-s3";
import { devices, type Db, type Envelope } from "@driftline/db";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Server, Socket } from "socket.io";

import type { env as Env } from "../../env.js";
import { createDownloadUrl } from "../../lib/r2-client.js";
import { resolvePrincipal } from "../../lib/principal.js";
import { verifyAccessToken } from "../../lib/tokens.js";
import { getDirectConversationOtherMember, isConversationMember } from "./conversations.service.js";
import {
  cancelPairingSession,
  getPairingSession,
  joinPairingSession,
} from "../devices/device-link.service.js";
import {
  deviceLinkCancelSchema,
  deviceLinkJoinSchema,
  deviceLinkSignalSchema,
} from "../devices/device-link.schemas.js";
import { tryExtractR2Key } from "../media/media.service.js";
import { getActiveDeviceIds, getActiveDeviceIdsForUsers, getConversationPartnerUserIds } from "../presence/presence.service.js";
import { ackEnvelope, drainPendingTargets, sendEnvelope } from "./envelopes.service.js";
import { conversationReadSchema, envelopeAckSchema, messageSendSchema } from "./socket.schemas.js";

interface SocketData {
  userId: string;
  deviceId: string;
}

interface R2Context {
  client: S3Client;
  bucket: string;
}

export interface RegisterSocketHandlersOptions {
  db: Db;
  env: typeof Env;
  redis: Redis;
  r2: R2Context;
}

function deviceRoom(deviceId: string): string {
  return `device:${deviceId}`;
}

// In-process presence state (docs/ADR/0011-presence-and-receipts.md) — deliberately not Redis or
// Postgres. A user is "online" iff this set is non-empty; the single-process deployment this app
// actually runs (ADR-0001, no clustering) makes this exact and free, unlike a TTL heartbeat that
// would need to guess at staleness. Would need revisiting (a shared store, or a Redis-backed
// Socket.IO adapter) if this server ever runs as more than one process.
const onlineDevicesByUser = new Map<string, Set<string>>();

// Exported for modules/relay/conversations.service.ts's attachMembers, which needs an online check
// per member but has no reason to otherwise depend on this module's connection-handling internals.
export function isUserOnline(userId: string): boolean {
  return (onlineDevicesByUser.get(userId)?.size ?? 0) > 0;
}

async function broadcastPresence(io: Server, db: Db, userId: string, online: boolean, lastSeenAt: Date | null): Promise<void> {
  const partnerUserIds = await getConversationPartnerUserIds(db, userId);
  const targetDeviceIds = await getActiveDeviceIdsForUsers(db, partnerUserIds);
  const payload = { userId, online, lastSeenAt: lastSeenAt?.toISOString() ?? null };
  for (const targetDeviceId of targetDeviceIds) {
    io.to(deviceRoom(targetDeviceId)).emit("presence:update", payload);
  }
}

// A coarse per-connection cap on device-link:join attempts — defense in depth on top of the
// per-session attempt cap in device-link.service.ts (docs/ADR/0008-device-linking-protocol.md).
// Not Redis-backed: a fresh socket connection gets a fresh budget, which is an acceptable trade-off
// at this scale, matching this codebase's existing preference for simple in-process state over new
// shared infra where the risk is low (see index.ts's in-process sweepers).
const MAX_JOIN_ATTEMPTS_PER_SOCKET = 5;

// docs/REALTIME_PROTOCOL.md documents every event this registers.
export function registerSocketHandlers(io: Server, { db, env, redis, r2 }: RegisterSocketHandlersOptions): void {
  io.use((socket, next) => {
    void authenticateSocket(db, env, socket, next);
  });

  io.on("connection", (socket) => {
    void handleConnection(io, db, env, redis, r2, socket);
  });
}

async function authenticateSocket(
  db: Db,
  env: typeof Env,
  socket: Socket,
  next: (err?: Error) => void,
): Promise<void> {
  const token = socket.handshake.auth?.token as unknown;
  if (typeof token !== "string") {
    next(new Error("Missing access token"));
    return;
  }

  try {
    // Same verification path as HTTP (ADR-0004 §1: one token, one check, no separate socket auth).
    const claims = await verifyAccessToken(token, env.JWT_SECRET);
    const principal = await resolvePrincipal(db, claims);
    if (!principal) {
      next(new Error("Device revoked or not found"));
      return;
    }
    const data: SocketData = { userId: principal.user.id, deviceId: principal.device.id };
    Object.assign(socket.data as Record<string, unknown>, data);
    next();
  } catch {
    next(new Error("Invalid or expired access token"));
  }
}

async function handleConnection(io: Server, db: Db, env: typeof Env, redis: Redis, r2: R2Context, socket: Socket): Promise<void> {
  const { userId, deviceId } = socket.data as SocketData;

  await socket.join(deviceRoom(deviceId));

  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  const wasDormant = Boolean(device?.dormantAt);

  await db.update(devices).set({ lastSeenAt: new Date(), dormantAt: null }).where(eq(devices.id, deviceId));

  // First device to connect for this user — they were fully offline until now (docs/ADR/0011).
  const onlineDevices = onlineDevicesByUser.get(userId) ?? new Set<string>();
  const wasOffline = onlineDevices.size === 0;
  onlineDevices.add(deviceId);
  onlineDevicesByUser.set(userId, onlineDevices);
  if (wasOffline) {
    void broadcastPresence(io, db, userId, true, null);
  }

  if (wasDormant) {
    // docs/RETENTION.md §6 point 2 — the client turns this into the "dormancy return" gap notice.
    socket.emit("dormancy:return");
  }

  // A device that reconnects days later gets a *freshly minted* download URL here, never a stale
  // one from send time (docs/ADR/0009-media-attachments.md).
  const pending = await drainPendingTargets(db, deviceId);
  for (const envelope of pending) {
    socket.emit("envelope:deliver", await toWireEnvelope(envelope, r2));
  }

  socket.on("message:send", (payload: unknown, ack?: (response: unknown) => void) => {
    void handleMessageSend(io, db, env, r2, socket, payload, ack);
  });

  socket.on("envelope:ack", (payload: unknown) => {
    void handleEnvelopeAck(io, db, r2, socket, payload);
  });

  socket.on("conversation:read", (payload: unknown) => {
    void handleConversationRead(io, db, socket, payload);
  });

  let deviceLinkJoinAttempts = 0;
  socket.on("device-link:join", (payload: unknown, ack?: (response: unknown) => void) => {
    deviceLinkJoinAttempts += 1;
    if (deviceLinkJoinAttempts > MAX_JOIN_ATTEMPTS_PER_SOCKET) {
      ack?.({ error: "Too many attempts — reconnect and try again" });
      return;
    }
    void handleDeviceLinkJoin(io, redis, socket, payload, ack);
  });

  socket.on("device-link:signal", (payload: unknown) => {
    void handleDeviceLinkSignal(io, redis, socket, payload);
  });

  socket.on("device-link:cancel", (payload: unknown) => {
    void handleDeviceLinkCancel(io, redis, socket, payload);
  });

  socket.on("disconnect", () => {
    void handleDisconnect(io, db, userId, deviceId);
  });
}

// The mirror image of the connect-time presence tracking above — updates lastSeenAt to reflect
// actual last-active time (not just last-connect time, docs/ADR/0011) and, if this was the user's
// last connected device, broadcasts them going offline.
async function handleDisconnect(io: Server, db: Db, userId: string, deviceId: string): Promise<void> {
  const now = new Date();
  await db.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, deviceId));

  const onlineDevices = onlineDevicesByUser.get(userId);
  onlineDevices?.delete(deviceId);
  if (onlineDevices && onlineDevices.size === 0) {
    onlineDevicesByUser.delete(userId);
    await broadcastPresence(io, db, userId, false, now);
  }
}

async function handleMessageSend(
  io: Server,
  db: Db,
  env: typeof Env,
  r2: R2Context,
  socket: Socket,
  rawPayload: unknown,
  ack?: (response: unknown) => void,
): Promise<void> {
  const { userId, deviceId } = socket.data as SocketData;

  const parsed = messageSendSchema.safeParse(rawPayload);
  if (!parsed.success) {
    ack?.({ error: parsed.error.issues.map((issue) => issue.message).join("; ") });
    return;
  }
  const input = parsed.data;

  const member = await isConversationMember(db, input.conversationId, userId);
  if (!member) {
    ack?.({ error: "Not a member of this conversation" });
    return;
  }

  const { envelope, targetDeviceIds } = await sendEnvelope(db, {
    conversationId: input.conversationId,
    senderId: userId,
    senderDeviceId: deviceId,
    contentType: input.contentType,
    payload: input.payload,
    retentionWindowDays: env.RETENTION_WINDOW_DAYS,
  });

  ack?.({ clientId: input.clientId, envelopeId: envelope.id, seq: envelope.seq });

  const wireEnvelope = await toWireEnvelope(envelope, r2);
  for (const targetDeviceId of targetDeviceIds) {
    io.to(deviceRoom(targetDeviceId)).emit("envelope:deliver", wireEnvelope);
  }
}

async function handleEnvelopeAck(io: Server, db: Db, r2: R2Context, socket: Socket, rawPayload: unknown): Promise<void> {
  const { deviceId } = socket.data as SocketData;

  const parsed = envelopeAckSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  const result = await ackEnvelope(db, { envelopeId: parsed.data.envelopeId, deviceId }, r2);

  // docs/ADR/0011-presence-and-receipts.md: fired to every one of the sender's own devices, not just
  // the one that happened to trigger this — including devices that were dormant/offline just now
  // (a Socket.IO emit to an unconnected room is a no-op, same as envelope:deliver's fan-out).
  if (result.deliveredToAllRecipients && result.senderId) {
    const senderDeviceIds = await getActiveDeviceIds(db, result.senderId);
    for (const senderDeviceId of senderDeviceIds) {
      io.to(deviceRoom(senderDeviceId)).emit("envelope:delivered", {
        envelopeId: parsed.data.envelopeId,
        conversationId: result.conversationId,
      });
    }
  }
}

// Pure signaling relay, same posture as device-link:signal — no Postgres/Redis persistence
// (docs/ADR/0011). Direct conversations only; the server never inspects throughSeq beyond the
// schema's positive-integer check, since it has no envelope state to validate it against by the
// time a user actually reads a message (the envelope is very likely already purged).
async function handleConversationRead(io: Server, db: Db, socket: Socket, rawPayload: unknown): Promise<void> {
  const { userId } = socket.data as SocketData;

  const parsed = conversationReadSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  const otherUserId = await getDirectConversationOtherMember(db, parsed.data.conversationId, userId);
  if (!otherUserId) return;

  const otherDeviceIds = await getActiveDeviceIds(db, otherUserId);
  for (const otherDeviceId of otherDeviceIds) {
    io.to(deviceRoom(otherDeviceId)).emit("conversation:read", {
      conversationId: parsed.data.conversationId,
      throughSeq: parsed.data.throughSeq,
    });
  }
}

// The new/empty device ("host") is already listening in its own deviceRoom (joined on connect,
// same as every socket) — no separate subscription step needed for it to receive peer-joined/signal/
// cancelled events.
async function handleDeviceLinkJoin(
  io: Server,
  redis: Redis,
  socket: Socket,
  rawPayload: unknown,
  ack?: (response: unknown) => void,
): Promise<void> {
  const { userId, deviceId } = socket.data as SocketData;

  const parsed = deviceLinkJoinSchema.safeParse(rawPayload);
  if (!parsed.success) {
    ack?.({ error: "Invalid or expired code" });
    return;
  }

  const result = await joinPairingSession(redis, parsed.data.code, userId, deviceId);
  if (!result) {
    // Deliberately one generic message for every failure case (expired, already matched, wrong
    // account, attempts exhausted) — docs/ADR/0008-device-linking-protocol.md.
    ack?.({ error: "Invalid or expired code" });
    return;
  }

  ack?.({ hostDeviceId: result.hostDeviceId });
  io.to(deviceRoom(result.hostDeviceId)).emit("device-link:peer-joined", { sourceDeviceId: deviceId });
}

// Pure relay — the server never inspects `signal` (opaque SDP/ICE JSON), only validates that the
// sender and target are exactly the two devices this specific matched pairing session recorded
// (ADR-0003: signalling only, and not a general arbitrary-device messaging channel).
async function handleDeviceLinkSignal(io: Server, redis: Redis, socket: Socket, rawPayload: unknown): Promise<void> {
  const { deviceId } = socket.data as SocketData;

  const parsed = deviceLinkSignalSchema.safeParse(rawPayload);
  if (!parsed.success) return;
  const { code, targetDeviceId, signal } = parsed.data;

  const session = await getPairingSession(redis, code);
  if (!session || session.status !== "matched" || !session.sourceDeviceId) return;

  const pairedDeviceIds = [session.hostDeviceId, session.sourceDeviceId];
  if (deviceId === targetDeviceId || !pairedDeviceIds.includes(deviceId) || !pairedDeviceIds.includes(targetDeviceId)) {
    return;
  }

  io.to(deviceRoom(targetDeviceId)).emit("device-link:signal", { fromDeviceId: deviceId, signal });
}

// Idempotent, callable by either side of a matched session (or the host of a still-`waiting` one).
// Explicitly deletes the Redis session rather than just marking it cancelled, and notifies whichever
// other device was involved so its UI doesn't sit waiting for its own timeout.
async function handleDeviceLinkCancel(io: Server, redis: Redis, socket: Socket, rawPayload: unknown): Promise<void> {
  const { deviceId } = socket.data as SocketData;

  const parsed = deviceLinkCancelSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  const session = await getPairingSession(redis, parsed.data.code);
  if (!session) return;

  const isHost = session.hostDeviceId === deviceId;
  const isSource = session.sourceDeviceId === deviceId;
  if (!isHost && !isSource) return;

  await cancelPairingSession(redis, parsed.data.code);

  const otherDeviceId = isHost ? session.sourceDeviceId : session.hostDeviceId;
  if (otherDeviceId) {
    io.to(deviceRoom(otherDeviceId)).emit("device-link:cancelled");
  }
}

// docs/ADR/0009-media-attachments.md: the one place a presigned download URL gets minted, for both
// fresh delivery and reconnect drain. Delivering this specific envelope to this specific device
// *is* the authorization check — no separate "give me a download URL for key X" endpoint exists.
async function toWireEnvelope(envelope: Envelope, r2: R2Context) {
  const base = {
    id: envelope.id,
    conversationId: envelope.conversationId,
    senderId: envelope.senderId,
    senderDeviceId: envelope.senderDeviceId,
    seq: envelope.seq,
    contentType: envelope.contentType,
    payload: envelope.payload,
    createdAt: envelope.createdAt,
  };

  const r2Key = tryExtractR2Key(envelope.contentType, envelope.payload);
  if (!r2Key) return base;

  try {
    const attachmentDownloadUrl = await createDownloadUrl(r2.client, r2.bucket, r2Key);
    return { ...base, attachmentDownloadUrl };
  } catch {
    // Best-effort: the client will just see a missing attachmentDownloadUrl and can't render the
    // image — not worth failing the whole delivery over.
    return base;
  }
}
