# ADR-0002: Retention & Storage Model

**Status:** Accepted — 2026-08-24

## Context

The defining constraint of this project (see project brief, R1–R7) is that the server is a transport,
not an archive: no message body is retained once delivered to every active device of every recipient,
and undelivered messages are hard-deleted after a fixed window. The reference architecture
(`design/reference-system-design.md`) assumes the opposite — permanent server-side history in a
key-value store — and its data model, multi-device sync design, and search/random-access features all
depend on that assumption. This ADR records the storage-model decision and, specifically, the
per-conversation-vs-global retention-window question raised in Phase 0.

## Decision

1. **Content is transient; routing/identity metadata is durable.** Concretely: `Envelope.payload`
   (and its R2 attachment counterpart) is deleted the instant the last `EnvelopeTarget` acks, or at
   `expiresAt`, whichever comes first — never later than 30 days from creation. `User`, `Device`,
   `Conversation`, `ConversationMember`, and `ConversationSequence` are durable Postgres rows with no
   TTL. There is no `Message` table anywhere in the durable schema — see `docs/RETENTION.md` for the
   full entity lifecycle.
2. **`RETENTION_WINDOW_DAYS` is a single global constant (`= 30`) for MVP, not per-conversation.**
   Per-conversation configurability was raised explicitly in Phase 0 discovery and decided against
   for MVP:
   - A global constant means one code path for `expiresAt` computation, one thing to test for the
     "no message bodies survive past the window" CI invariant (Phase 9's `retention.yml`), and one
     number to explain in the transparency page and privacy policy.
   - Per-conversation TTLs would require the TTL to travel with every conversation's membership state,
     be enforceable against every member (what happens when two members disagree on a shorter
     window?), and be re-verified by the retention CI job per-conversation rather than globally —
     meaningfully more surface area for a feature that isn't validated as something users want yet.
   - This is explicitly deferred to MVP+, not rejected outright. If it ships later, it becomes a
     `retentionWindowDays` column on `Conversation` with a server-enforced minimum and maximum, and
     `expiresAt` computation reads from the conversation instead of the constant — a additive change,
     not a rewrite, because every write path already computes `expiresAt` at envelope-creation time
     rather than assuming the global constant inline.
3. **Deletion is unconditional and immediate on the ack path**, not batched. The purge happens in the
   same transaction as the ack that completes it. This is a deliberate rejection of the more common
   "soft delete + nightly cleanup job" pattern, because a soft-delete flag is still content sitting on
   disk — it fails the "never retains" requirement even if hidden from queries.
4. **The 30-day window applies uniformly to messages, receipts, reactions, and attachments.** All are
   envelopes; none get bespoke retention logic. This keeps the "no server code reads a message body"
   invariant enforceable by one mechanical check (Phase 1) rather than several.

## Consequences

- No search, "jump to message," or mentions view is possible server-side, ever — not as a missing
  feature to add later, but as a structural consequence of this decision. All of it moves to
  `packages/local-store`/`packages/sync-engine` (Phase 4), which is why those are first-class shared
  packages rather than thin client-side caches.
- The server cannot help a new device "catch up" beyond whatever is still pending at the moment it
  connects. This has its own ADR (ADR-0003) because it changes the multi-device sync design, not just
  the storage layer.
- Storage cost is bounded and predictable: worst case is `RETENTION_WINDOW_DAYS` × peak undelivered
  throughput, not a growing-forever ledger. This is a genuine operational advantage on a free-tier
  Postgres instance, independent of the privacy story.
- The transparency/privacy documentation (Phase 8) is unusually easy to write honestly, because the
  schema itself has no field to describe as "we keep your messages" — there's nothing to euphemize.
- Losing a device without a backup is a real, permanent data-loss event for the user. This is treated
  as a UX problem to be honest about (Phase 5/6 backup nagging, gap notices), not an edge case to
  minimize in the docs.

## Alternatives considered and rejected

- **Per-conversation configurable TTL for MVP**: rejected for MVP per point 2 above; revisit once
  the global-constant version is shipped and validated.
- **Soft delete + scheduled hard delete**: rejected — content-at-rest for any period after
  "delivered" violates R1, regardless of query-time visibility.
- **Encrypt-then-retain-forever (i.e., keep ciphertext permanently, rely on E2EE for privacy)**:
  rejected as a substitute for retention limits. E2EE (stretch backlog) and retention limits are
  complementary, not interchangeable — the project's differentiator is data minimization, not just
  confidentiality, and R7 treats every body as opaque today specifically so E2EE is additive later
  rather than a reason to relax retention now.
