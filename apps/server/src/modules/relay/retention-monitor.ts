import { envelopes, type Db } from "@driftline/db";
import { asc } from "drizzle-orm";

export interface RetentionComplianceResult {
  compliant: boolean;
  oldestEnvelopeAgeMs: number | null;
}

// docs/RETENTION.md §7's last unchecked checklist item: alert if the oldest still-present envelope
// is older than RETENTION_WINDOW_DAYS — that means the sweeper itself is broken and content is
// being retained silently past the contract. Checked directly against createdAt rather than
// expiresAt, so a bug in expiresAt's own computation can't mask itself from this check.
export async function checkRetentionCompliance(db: Db, retentionWindowDays: number): Promise<RetentionComplianceResult> {
  const [oldest] = await db.select({ createdAt: envelopes.createdAt }).from(envelopes).orderBy(asc(envelopes.createdAt)).limit(1);

  if (!oldest) {
    return { compliant: true, oldestEnvelopeAgeMs: null };
  }

  const oldestEnvelopeAgeMs = Date.now() - oldest.createdAt.getTime();
  const windowMs = retentionWindowDays * 24 * 60 * 60 * 1000;
  return { compliant: oldestEnvelopeAgeMs <= windowMs, oldestEnvelopeAgeMs };
}
