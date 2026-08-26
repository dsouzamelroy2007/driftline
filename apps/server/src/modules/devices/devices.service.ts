import type { S3Client } from "@aws-sdk/client-s3";
import { devices, envelopeTargets, type Db, type Device } from "@driftline/db";
import { and, desc, eq } from "drizzle-orm";

import { logEnvelopePurged } from "../../lib/metrics.js";
import { cleanupPurgedMedia } from "../media/media.service.js";
import { purgeEnvelopeIfComplete, type PurgeResult } from "../relay/purge.js";

export function listDevices(db: Db, userId: string): Promise<Device[]> {
  return db.select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.lastSeenAt));
}

// Revocation is synchronous and stronger than dormancy (docs/RETENTION.md §5): it deletes the
// device's pending EnvelopeTarget rows immediately rather than waiting for the sweeper. If that
// deletion happens to remove an envelope's last pending target, purge the envelope too — otherwise
// it would sit as an orphan (every other recipient already has it) until expiry, purely because
// this device revoked rather than acked.
//
// R2 cleanup (docs/ADR/0009-media-attachments.md) for any purged media envelope runs only *after*
// the transaction below commits — purge results are collected during the transaction and acted on
// once db.transaction(...) has resolved, not from inside it.
export async function revokeDevice(db: Db, deviceId: string, userId: string, r2: { client: S3Client; bucket: string }): Promise<boolean> {
  const { revoked, purgeResults } = await db.transaction(async (tx) => {
    const [revokedRow] = await tx
      .update(devices)
      .set({ revokedAt: new Date(), refreshTokenHash: null, refreshTokenExpiresAt: null })
      .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
      .returning();
    if (!revokedRow) {
      return { revoked: false, purgeResults: [] as PurgeResult[] };
    }

    const removedTargets = await tx
      .delete(envelopeTargets)
      .where(and(eq(envelopeTargets.deviceId, deviceId), eq(envelopeTargets.status, "pending")))
      .returning({ envelopeId: envelopeTargets.envelopeId });

    const affectedEnvelopeIds = new Set(removedTargets.map((row) => row.envelopeId));
    const results: PurgeResult[] = [];
    for (const envelopeId of affectedEnvelopeIds) {
      const result = await purgeEnvelopeIfComplete(tx, envelopeId);
      if (result.purged) {
        logEnvelopePurged("ack", envelopeId, result.size ?? 0);
      }
      results.push(result);
    }

    return { revoked: true, purgeResults: results };
  });

  for (const result of purgeResults) {
    if (result.purged) {
      await cleanupPurgedMedia(r2.client, r2.bucket, result);
    }
  }

  return revoked;
}
