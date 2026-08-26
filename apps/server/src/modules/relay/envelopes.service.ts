import {
  conversationMembers,
  conversationSequences,
  devices,
  envelopeTargets,
  envelopes,
  type Db,
  type Envelope,
} from "@driftline/db";
import type { S3Client } from "@aws-sdk/client-s3";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";

import { HttpError } from "../../lib/errors.js";
import { logEnvelopePurged } from "../../lib/metrics.js";
import { cleanupPurgedMedia } from "../media/media.service.js";
import { purgeEnvelopeIfComplete } from "./purge.js";

export interface SendEnvelopeInput {
  conversationId: string;
  senderId: string;
  senderDeviceId: string;
  contentType: string;
  payload: string;
  retentionWindowDays: number;
}

export interface SendEnvelopeResult {
  envelope: Envelope;
  targetDeviceIds: string[];
}

// One transaction: bump the conversation's sequence counter, insert the envelope, and fan out to
// every active device (not revoked, not dormant) of every member except the sender's own device —
// ADR-0003 §1 (fan-out-on-write, one EnvelopeTarget row per device, not per user).
export async function sendEnvelope(db: Db, input: SendEnvelopeInput): Promise<SendEnvelopeResult> {
  return db.transaction(async (tx) => {
    const [seqRow] = await tx
      .update(conversationSequences)
      .set({ seq: sql`${conversationSequences.seq} + 1` })
      .where(eq(conversationSequences.conversationId, input.conversationId))
      .returning({ seq: conversationSequences.seq });

    if (!seqRow) {
      throw new HttpError(404, "Conversation not found");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.retentionWindowDays * 24 * 60 * 60 * 1000);

    const [envelope] = await tx
      .insert(envelopes)
      .values({
        conversationId: input.conversationId,
        senderId: input.senderId,
        senderDeviceId: input.senderDeviceId,
        seq: seqRow.seq,
        contentType: input.contentType,
        payload: input.payload,
        size: Buffer.byteLength(input.payload),
        createdAt: now,
        expiresAt,
      })
      .returning();
    const insertedEnvelope = envelope!;

    const targetDevices = await tx
      .select({ id: devices.id, userId: devices.userId })
      .from(devices)
      .innerJoin(conversationMembers, eq(conversationMembers.userId, devices.userId))
      .where(
        and(
          eq(conversationMembers.conversationId, input.conversationId),
          isNull(devices.revokedAt),
          isNull(devices.dormantAt),
          ne(devices.id, input.senderDeviceId),
        ),
      );

    if (targetDevices.length > 0) {
      await tx.insert(envelopeTargets).values(
        targetDevices.map((device) => ({
          envelopeId: insertedEnvelope.id,
          recipientUserId: device.userId,
          deviceId: device.id,
        })),
      );
    }

    return { envelope: insertedEnvelope, targetDeviceIds: targetDevices.map((device) => device.id) };
  });
}

export interface AckEnvelopeInput {
  envelopeId: string;
  deviceId: string;
}

export interface AckEnvelopeResult {
  purged: boolean;
}

// The hot path: every message ack runs this. See purge.ts for why the FOR UPDATE lock is required.
// R2 cleanup (docs/ADR/0009-media-attachments.md) runs only *after* the transaction below has
// committed — awaiting db.transaction(...) here, rather than returning it directly, is what makes
// that possible: code after the await runs post-commit.
export async function ackEnvelope(db: Db, input: AckEnvelopeInput, r2: { client: S3Client; bucket: string }): Promise<AckEnvelopeResult> {
  const result = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(envelopeTargets)
      .set({ status: "delivered" })
      .where(
        and(
          eq(envelopeTargets.envelopeId, input.envelopeId),
          eq(envelopeTargets.deviceId, input.deviceId),
          eq(envelopeTargets.status, "pending"),
        ),
      )
      .returning();

    if (!updated) {
      // Already acked, unknown envelope, or this device was never a target — idempotent no-op.
      return { purged: false };
    }

    const purgeResult = await purgeEnvelopeIfComplete(tx, input.envelopeId);
    if (purgeResult.purged) {
      logEnvelopePurged("ack", input.envelopeId, purgeResult.size ?? 0);
    }
    return purgeResult;
  });

  if (result.purged) {
    await cleanupPurgedMedia(r2.client, r2.bucket, result);
  }

  return { purged: result.purged };
}

// On reconnect a device drains what's currently pending for it — not cursor replay (ADR-0003 §2).
export async function drainPendingTargets(db: Db, deviceId: string): Promise<Envelope[]> {
  const rows = await db
    .select({ envelope: envelopes })
    .from(envelopeTargets)
    .innerJoin(envelopes, eq(envelopeTargets.envelopeId, envelopes.id))
    .where(and(eq(envelopeTargets.deviceId, deviceId), eq(envelopeTargets.status, "pending")))
    .orderBy(asc(envelopes.conversationId), asc(envelopes.seq));

  return rows.map((row) => row.envelope);
}
