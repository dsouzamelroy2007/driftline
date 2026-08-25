import { envelopeTargets, envelopes, type Db } from "@driftline/db";
import { asc, eq } from "drizzle-orm";

export interface StorageSummary {
  envelopeCount: number;
  oldestExpiresAt: string | null;
}

// The "you currently have N messages held on our servers" widget (docs/UI_DIRECTION.md §8) —
// counts this user's still-pending EnvelopeTarget rows, never anything content-derived
// (docs/RETENTION.md §2: envelope metadata/targets are routing state, not content).
export async function getStorageSummary(db: Db, userId: string): Promise<StorageSummary> {
  // Distinct by envelope, not by target row — a group message queued for three of the user's
  // devices is still one message, not three.
  const rows = await db
    .selectDistinct({ envelopeId: envelopes.id, expiresAt: envelopes.expiresAt })
    .from(envelopeTargets)
    .innerJoin(envelopes, eq(envelopeTargets.envelopeId, envelopes.id))
    .where(eq(envelopeTargets.recipientUserId, userId))
    .orderBy(asc(envelopes.expiresAt));

  return {
    envelopeCount: rows.length,
    oldestExpiresAt: rows[0]?.expiresAt.toISOString() ?? null,
  };
}
