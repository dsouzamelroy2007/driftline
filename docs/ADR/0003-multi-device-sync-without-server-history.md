# ADR-0003: Multi-Device Sync Without Server History

**Status:** Accepted — 2026-08-24

## Context

The reference architecture's multi-device sync trick is: each device tracks `cur_max_message_id`; on
reconnect, it asks the permanent KV store for everything newer than its cursor, for the currently
logged-in user. That works because the store is a permanent, append-only ledger every device can
rewind into indefinitely.

Under ADR-0002, no such ledger exists. An envelope is deleted the moment its last target acks, and
unconditionally at 30 days regardless of ack state. A device that reconnects cannot ask "give me
everything since cursor X" — most of what happened since X may already be gone, correctly, by design.
This is not a smaller version of the reference trick; it's a different guarantee, and it has to be
designed as one, not discovered as a bug once multi-device testing starts.

## Decision

**Per-device delivery cursor + fan-out-on-write, with explicit gap detection — replacing cursor
replay.**

1. Every active device gets its own `EnvelopeTarget` row at send time (fan-out-on-write, inherited
   from the reference doc's inbox model — see `DESIGN_REVIEW.md`). There is no single per-user
   cursor; there is one delivery cursor per device, because each device's target set is genuinely
   independent (a dormant laptop and an active phone do not share fan-out).
2. On reconnect, a device does **not** ask "what's new since X." It asks "what's currently `pending`
   for me" — i.e., it drains its own `EnvelopeTarget` rows for that device ID. This is the entire
   catch-up mechanism. There is no larger history to reconcile against.
3. **Sequence numbers still matter for ordering and gap detection**, even though they no longer
   enable replay. `ConversationSequence` is a durable, monotonic, per-conversation counter (metadata,
   not content — survives under ADR-0002). Every envelope gets a sequence number when created. A
   device that sees sequence N followed by sequence N+3 knows two envelopes were purged (delivered
   elsewhere and acked, or expired) before it could receive them, and raises a gap notice
   (`docs/RETENTION.md` §6) instead of silently reordering or silently doing nothing.
4. **A brand-new or reinstalled device starts empty and does not attempt catch-up at all** (R4) — it
   has no prior cursor, no prior sequence baseline, and by design gets no server-side backfill. Its
   *only* paths to prior history are:
   - **Encrypted backup import** (Phase 6) — the baseline mechanism, ships first.
   - **Device-to-device transfer over a WebRTC data channel**, server relaying signalling only
     (Phase 6) — **decided as MVP scope**, not stretch, per Phase 0 discovery. This is the more
     demanding of the two mechanisms (NAT traversal, resumable transfer, progress UI) and is
     explicitly at risk of slipping to MVP+ if the signalling/transfer work proves more costly than
     estimated in `docs/ROADMAP.md`; if it slips, backup-file linking remains the fallback path and
     this ADR's decision reverts to "P2P is stretch" with a follow-up ADR recording why.
5. Both new-device paths write directly into the local store (`packages/local-store`) and only then
   resume normal fan-out-on-write sync — the device is "caught up" the moment the transfer/import
   finishes, not before.

## Consequences

- Multi-device is genuinely harder to reason about than in the reference design, because there is no
  shared source of truth a device can always fall back to — each device's local store plus its own
  `EnvelopeTarget` drain *is* its state. Two devices of the same user are allowed to be
  self-consistent but divergent (e.g., one has imported an old backup and has more history than the
  other) — this is treated as expected behavior, tested for explicitly in Phase 4, not a bug to
  eliminate.
- Committing to P2P transfer as MVP (not stretch) means Phase 6 carries real technical risk: WebRTC
  NAT traversal without a paid TURN service is the known hard part. The free-tier plan is a public
  STUN server (no cost) plus best-effort direct/relay-through-peer connectivity; if two devices can't
  establish a data channel (symmetric NAT on both sides, worst case), the flow must fall back to the
  backup-file path automatically with a clear message, not fail silently. This fallback is part of
  the MVP definition of done for the feature, not an afterthought.
- Losing all devices without ever exporting a backup is unrecoverable data loss. This ADR does not
  soften that; the honest UX response (backup nagging, modeled on Signal) is a product decision
  covered in Phase 5/6, not a storage decision.
- Because gap detection is sequence-based and computed entirely client-side from data the server
  already exposes (sequence numbers are metadata, not content), no new server-side "did I lose
  something" bookkeeping is required — the server never needs to know a gap occurred, only that it
  correctly purged what it purged.

## Alternatives considered and rejected

- **Keep a permanent per-user "last N message IDs seen" index without the bodies**, to let a
  reconnecting device at least know *how much* it missed even if not *what*: rejected as unnecessary
  complexity — the sequence-gap mechanism already gives a device that signal for free from data it
  already has (its own last-seen sequence number vs. the next one it receives), with no extra durable
  state.
- **Server-mediated device-to-device transfer** (server temporarily stores the outgoing device's
  export until the new device fetches it): rejected — this reintroduces server-side content retention,
  exactly what ADR-0002 rules out, even if time-boxed. WebRTC keeps content off the server entirely,
  which is the point.
- **P2P transfer as stretch-only (original master-plan default)**: reconsidered and overridden in
  Phase 0 discovery at the user's explicit direction; recorded here specifically because it reverses
  the master prompt's own suggested default, and the risk/fallback plan above exists because of that
  reversal.
