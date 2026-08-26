// docs/RETENTION.md §3: both purge paths emit a metric (envelope_purged_total{reason}) and a
// structured log line with the envelope ID and size only — never the payload, never anything
// content-derived. Device revocation purges an orphaned envelope the same way the ack path does
// (see modules/relay/purge.ts), so it's logged under reason "ack" too — RETENTION.md only defines
// "ack" and "expiry" as reasons, and revocation is the same immediate/transactional character as
// an ack, not a batch expiry sweep.
export function logEnvelopePurged(reason: "ack" | "expiry", envelopeId: string, size: number): void {
  console.log(
    JSON.stringify({
      metric: "envelope_purged_total",
      reason,
      envelopeId,
      size,
      ts: new Date().toISOString(),
    }),
  );
}

// docs/ADR/0009-media-attachments.md: R2 cleanup runs after the Postgres purge has already
// committed — its own success/failure is logged separately from envelope_purged_total rather than
// folded into it, since a failure here doesn't mean the retention guarantee itself failed (the
// Postgres row is already gone by the time this runs).
export function logMediaObjectPurged(r2Key: string): void {
  console.log(JSON.stringify({ metric: "media_object_purged_total", r2Key, ts: new Date().toISOString() }));
}

export function logMediaCleanupFailed(r2Key: string, error: unknown): void {
  console.error(
    JSON.stringify({
      metric: "media_cleanup_failed_total",
      r2Key,
      error: error instanceof Error ? error.message : String(error),
      ts: new Date().toISOString(),
    }),
  );
}
