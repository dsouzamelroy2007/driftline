import { envelopes, type Db } from "@driftline/db";
import { inArray, lt } from "drizzle-orm";

import { logEnvelopePurged } from "../../lib/metrics.js";

export interface SweepResult {
  purgedCount: number;
  durationMs: number;
}

// Unconditional cutoff: an envelope past expiresAt is deleted regardless of remaining pending
// target state (docs/RETENTION.md §3). Batched so a large backlog can't hold one giant delete open.
// A plain function (not tied to Fastify) so it's callable from a setInterval and directly testable.
export async function sweepExpiredEnvelopes(db: Db, batchSize = 500): Promise<SweepResult> {
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
      .returning({ id: envelopes.id, size: envelopes.size });

    for (const row of deleted) {
      logEnvelopePurged("expiry", row.id, row.size);
    }
    purgedCount += deleted.length;

    if (expired.length < batchSize) break;
  }

  return { purgedCount, durationMs: Date.now() - start };
}
