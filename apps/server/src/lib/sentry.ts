import * as Sentry from "@sentry/node";

// docs/ADR/0001-stack.md commits to "PII scrubbing configured from day one, not bolted on later" —
// this module is that day-one config, not a placeholder to harden later. sendDefaultPii stays
// false (Sentry's own default) so no IP address, cookie, or request body is attached automatically,
// and beforeSend strips auth headers from whatever request context does get attached — the same
// discipline docs/RETENTION.md already requires of every purge-path log line, extended here.
export function initSentry(dsn: string | undefined, environment: string): void {
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment,
    sendDefaultPii: false,
    beforeSend(event) {
      const headers = event.request?.headers;
      if (headers) {
        delete headers["authorization"];
        delete headers["Authorization"];
        delete headers["cookie"];
        delete headers["Cookie"];
      }
      return event;
    },
  });
}

export function captureException(error: unknown): void {
  Sentry.captureException(error);
}

// docs/RETENTION.md §7's last unchecked checklist item: this is the alerting surface for "the
// sweeper is broken and content is being retained silently past the contract" — see
// modules/relay/retention-monitor.ts for the actual check.
export function captureRetentionViolation(oldestEnvelopeAgeMs: number, retentionWindowDays: number): void {
  const ageDays = (oldestEnvelopeAgeMs / (24 * 60 * 60 * 1000)).toFixed(1);
  Sentry.captureMessage(
    `Retention violation: oldest pending envelope is ${ageDays} days old, past the ${retentionWindowDays}-day window`,
    "fatal",
  );
}

// Sentry sends events asynchronously — calling this before process.exit() gives an
// uncaughtException/unhandledRejection's captured event a chance to actually reach Sentry instead
// of being dropped mid-flight by the process exiting first.
export function flushSentry(timeoutMs: number): Promise<boolean> {
  return Sentry.flush(timeoutMs);
}
