import { devices, type Db, type Envelope } from "@driftline/db";
import { eq } from "drizzle-orm";
import type { Server, Socket } from "socket.io";

import type { env as Env } from "../../env.js";
import { resolvePrincipal } from "../../lib/principal.js";
import { verifyAccessToken } from "../../lib/tokens.js";
import { isConversationMember } from "./conversations.service.js";
import { ackEnvelope, drainPendingTargets, sendEnvelope } from "./envelopes.service.js";
import { envelopeAckSchema, messageSendSchema } from "./socket.schemas.js";

interface SocketData {
  userId: string;
  deviceId: string;
}

export interface RegisterSocketHandlersOptions {
  db: Db;
  env: typeof Env;
}

function deviceRoom(deviceId: string): string {
  return `device:${deviceId}`;
}

// docs/REALTIME_PROTOCOL.md documents every event this registers.
export function registerSocketHandlers(io: Server, { db, env }: RegisterSocketHandlersOptions): void {
  io.use((socket, next) => {
    void authenticateSocket(db, env, socket, next);
  });

  io.on("connection", (socket) => {
    void handleConnection(io, db, env, socket);
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

async function handleConnection(io: Server, db: Db, env: typeof Env, socket: Socket): Promise<void> {
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
