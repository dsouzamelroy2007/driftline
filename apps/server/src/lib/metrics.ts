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
