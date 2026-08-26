import type { S3Client } from "@aws-sdk/client-s3";
import { envelopes, type Db } from "@driftline/db";
import { inArray, lt } from "drizzle-orm";

import { logEnvelopePurged } from "../../lib/metrics.js";
import { cleanupPurgedMedia } from "../media/media.service.js";

export interface SweepResult {
  purgedCount: number;
  durationMs: number;
}

// Unconditional cutoff: an envelope past expiresAt is deleted regardless of remaining pending
// target state (docs/RETENTION.md §3). Batched so a large backlog can't hold one giant delete open.
// A plain function (not tied to Fastify) so it's callable from a setInterval and directly testable.
//
// Each batch's delete is already its own committed statement (no explicit transaction wraps it), so
// R2 cleanup (docs/ADR/0009-media-attachments.md) for any media envelope in the batch runs right
// after — never blocking or risking the next batch's Postgres delete.
export async function sweepExpiredEnvelopes(db: Db, r2: { client: S3Client; bucket: string }, batchSize = 500): Promise<SweepResult> {
  const start = Date.now();
  let purgedCount = 0;

  for (;;) {
    const expired = await db
      .select({ id: envelopes.id })
      .from(envelopes)
      .where(lt(envelopes.expiresAt, new Date()))
      .limit(batchSize);

    if (expired.length === 0) break;

    const deleted = await db
      .delete(envelopes)
      .where(
        inArray(
          envelopes.id,
          expired.map((row) => row.id),
        ),
      )
      .returning({ id: envelopes.id, size: envelopes.size, contentType: envelopes.contentType, payload: envelopes.payload });

    for (const row of deleted) {
      logEnvelopePurged("expiry", row.id, row.size);
      await cleanupPurgedMedia(r2.client, r2.bucket, row);
    }
    purgedCount += deleted.length;

    if (expired.length < batchSize) break;
  }

  return { purgedCount, durationMs: Date.now() - start };
}
