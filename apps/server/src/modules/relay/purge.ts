import { envelopeTargets, envelopes, type Tx } from "@driftline/db";
import { and, count, eq, sql } from "drizzle-orm";

export interface PurgeResult {
  purged: boolean;
  size?: number;
  // Only present when purged — carried out so the caller can run cleanupPurgedMedia (modules/media/
  // media.service.ts) *after* its own transaction commits (docs/ADR/0009-media-attachments.md: R2
  // cleanup can't be transactional with Postgres and must never block or roll back the actual
  // retention guarantee).
  contentType?: string;
  payload?: string;
}

/**
 * Must run as one step inside a transaction that has *already* made its own mutation to this
 * envelope's target set (either an ack's UPDATE to `delivered`, or revocation's DELETE of a
 * device's pending target row) — this function only decides whether that mutation was the last
 * one and, if so, deletes the envelope.
 *
 * The `SELECT ... FOR UPDATE` is what makes this race-safe: without it, two devices acking the
 * last two pending targets of the same envelope concurrently could each run their own UPDATE
 * (different rows, no conflict), then both COUNT the remaining pending targets before the other's
 * UPDATE commits — under READ COMMITTED, neither sees the other's change, both count > 0, and the
 * envelope never gets purged. Locking the envelope row here forces the second caller to wait for
 * the first to commit, so its COUNT reads the first caller's already-committed change.
 */
export async function purgeEnvelopeIfComplete(tx: Tx, envelopeId: string): Promise<PurgeResult> {
  const locked = await tx.execute(sql`SELECT id FROM envelopes WHERE id = ${envelopeId} FOR UPDATE`);
  if (locked.rows.length === 0) {
    // Already purged by a concurrent ack/revocation/sweeper run — nothing to do.
    return { purged: false };
  }

  const [row] = await tx
    .select({ pendingCount: count() })
    .from(envelopeTargets)
    .where(and(eq(envelopeTargets.envelopeId, envelopeId), eq(envelopeTargets.status, "pending")));

  if (row!.pendingCount > 0) {
    return { purged: false };
  }

  // FK cascade (envelope_targets.envelope_id -> envelopes.id ON DELETE CASCADE) removes every
  // target row for this envelope in the same statement — docs/RETENTION.md §3/§4.
  const [deleted] = await tx
    .delete(envelopes)
    .where(eq(envelopes.id, envelopeId))
    .returning({ size: envelopes.size, contentType: envelopes.contentType, payload: envelopes.payload });
  return { purged: true, size: deleted?.size, contentType: deleted?.contentType, payload: deleted?.payload };
}
