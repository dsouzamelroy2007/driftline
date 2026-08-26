import { devices, type Db, type Envelope } from "@driftline/db";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Server, Socket } from "socket.io";

import type { env as Env } from "../../env.js";
import { resolvePrincipal } from "../../lib/principal.js";
import { verifyAccessToken } from "../../lib/tokens.js";
import { isConversationMember } from "./conversations.service.js";
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
import { ackEnvelope, drainPendingTargets, sendEnvelope } from "./envelopes.service.js";
import { envelopeAckSchema, messageSendSchema } from "./socket.schemas.js";

interface SocketData {
  userId: string;
  deviceId: string;
}

export interface RegisterSocketHandlersOptions {
  db: Db;
  env: typeof Env;
  redis: Redis;
}

function deviceRoom(deviceId: string): string {
  return `device:${deviceId}`;
}

// A coarse per-connection cap on device-link:join attempts — defense in depth on top of the
// per-session attempt cap in device-link.service.ts (docs/ADR/0008-device-linking-protocol.md).
// Not Redis-backed: a fresh socket connection gets a fresh budget, which is an acceptable trade-off
// at this scale, matching this codebase's existing preference for simple in-process state over new
// shared infra where the risk is low (see index.ts's in-process sweepers).
const MAX_JOIN_ATTEMPTS_PER_SOCKET = 5;

// docs/REALTIME_PROTOCOL.md documents every event this registers.
export function registerSocketHandlers(io: Server, { db, env, redis }: RegisterSocketHandlersOptions): void {
  io.use((socket, next) => {
    void authenticateSocket(db, env, socket, next);
  });

  io.on("connection", (socket) => {
    void handleConnection(io, db, env, redis, socket);
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

async function handleConnection(io: Server, db: Db, env: typeof Env, redis: Redis, socket: Socket): Promise<void> {
  const { deviceId } = socket.data as SocketData;

  await socket.join(deviceRoom(deviceId));

  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1);
  const wasDormant = Boolean(device?.dormantAt);

  await db.update(devices).set({ lastSeenAt: new Date(), dormantAt: null }).where(eq(devices.id, deviceId));

  if (wasDormant) {
    // docs/RETENTION.md §6 point 2 — the client turns this into the "dormancy return" gap notice.
    socket.emit("dormancy:return");
  }

  const pending = await drainPendingTargets(db, deviceId);
  for (const envelope of pending) {
    socket.emit("envelope:deliver", toWireEnvelope(envelope));
  }

  socket.on("message:send", (payload: unknown, ack?: (response: unknown) => void) => {
    void handleMessageSend(io, db, env, socket, payload, ack);
  });

  socket.on("envelope:ack", (payload: unknown) => {
    void handleEnvelopeAck(db, socket, payload);
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
}

async function handleMessageSend(
  io: Server,
  db: Db,
  env: typeof Env,
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

  for (const targetDeviceId of targetDeviceIds) {
    io.to(deviceRoom(targetDeviceId)).emit("envelope:deliver", toWireEnvelope(envelope));
  }
}

async function handleEnvelopeAck(db: Db, socket: Socket, rawPayload: unknown): Promise<void> {
  const { deviceId } = socket.data as SocketData;

  const parsed = envelopeAckSchema.safeParse(rawPayload);
  if (!parsed.success) return;

  await ackEnvelope(db, { envelopeId: parsed.data.envelopeId, deviceId });
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

function toWireEnvelope(envelope: Envelope) {
  return {
    id: envelope.id,
    conversationId: envelope.conversationId,
    senderId: envelope.senderId,
    senderDeviceId: envelope.senderDeviceId,
    seq: envelope.seq,
    contentType: envelope.contentType,
    payload: envelope.payload,
    createdAt: envelope.createdAt,
  };
}
