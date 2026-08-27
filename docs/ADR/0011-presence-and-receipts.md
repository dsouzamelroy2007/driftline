# ADR-0011: Delivery/Read Ticks and Presence — Live-Only, No New Persistence

**Status:** Accepted — 2026-08-27

## Context

Phase 6 part 5 (`docs/ROADMAP.md`), the last of the four items from the 2026-08-27 manual test pass
that isn't cosmetic. Three related asks: sent/delivered/read ticks on message bubbles (with a
non-blue "read" color, to avoid the exact WhatsApp look), and "last seen" for the other person in a
conversation. `docs/RETENTION.md` §2 already reserved "Presence / heartbeat state, Redis, TTL 30s"
back in Phase 0 planning, but no relay event for any of this was ever built — `modules/relay/
socket.ts` only has `envelope:ack`, which the UI has only ever used to trigger server-side purge,
never to tell the *sender* anything.

The MVP cut (`docs/ROADMAP.md`) already lists presence, typing, and delivery/read receipts as MVP
scope, not a stretch add-on — this is catching up on already-planned work, not new scope creep.
Typing indicators are explicitly out of this pass: none of the six manual-test-pass items asked for
them, and they weren't part of the six-item list this phase is closing out.

## Decision

**Ticks and presence are live-only — no new Postgres schema, no new Redis persistence.** A device
that's offline at the exact moment a message is delivered or read simply doesn't retroactively learn
about it — its tick stays one state behind until a *later* live event (a newer message getting read
also retroactively covers older ones, since read is a watermark — see below) catches it up, or it
just stays stale for that one message. This mirrors this project's existing pattern of accepting
narrow, low-consequence races rather than building exhaustive state machines for them (ADR-0009's
orphaned-R2-object risk, the sender/incoming-envelope race in `packages/local-store`). The
alternative — persisting per-message delivery/read state — would need either a new Postgres table
(a schema change, which this project's working agreement gates on asking first) or a new category of
durable Redis state beyond what `docs/RETENTION.md` §2 already reserves, for a cosmetic feature where
the common case (both parties online within the same chat session) already works correctly live.

**Delivery tick fires once every *recipient* target has acked — not every target.** `EnvelopeTarget`
rows include the sender's *other* devices too (ADR-0003 §1's own-device multi-device sync), and full
envelope purge requires every target including those to ack. Gating the tick on full purge would mean
an account with a second, often-idle device could rarely see a delivered tick at all. Instead,
`ackEnvelope` (`modules/relay/envelopes.service.ts`) now also checks whether every
`EnvelopeTarget.recipientUserId != senderId` row is non-pending, independent of the sender's own
other devices' ack state, and returns that alongside the existing purge result. `modules/relay/
socket.ts`'s `handleEnvelopeAck` emits a new **`envelope:delivered`** event (`{envelopeId,
conversationId}`) to every one of the sender's own active devices when that flips true. This can fire
on an earlier ack than the one that finally triggers purge, and may fire redundantly on a later
purge-triggering ack from the sender's own lagging device — harmless, since the client applies it
idempotently.

**Read receipts are scoped to direct conversations only.** A group's per-member read state (who of N
people has seen this) is a materially bigger feature — a details view, not a single tick color — and
nothing in the six reported items asked for it; WhatsApp itself only colorizes ticks per-message for
1:1 chats for the same reason. A recipient's client emits a new **`conversation:read`** event
(`{conversationId, throughSeq}`) whenever its existing local "last read" tracking
(`apps/web/lib/read-state.ts`, built in Phase 5 for the unread badge) advances in a direct
conversation. The server validates the conversation is actually `type: "direct"` and the emitting
device is a member, looks up the *other* member, and relays the same event shape to every one of
their active devices — pure signaling, no Postgres/Redis involvement, the same pattern
`device-link:signal` already established for opaque bidirectional relay. `throughSeq` is a watermark,
not a per-message flag: the sender's client marks every one of its own messages with `seq <=
throughSeq` as read, so one event catches up everything at once and self-heals past any single missed
event as long as a later one arrives.

**Presence ("online" / "last seen") reuses the existing `devices.lastSeenAt` column — no schema
change.** It was already updated on connect (`docs/REALTIME_PROTOCOL.md` §3); this adds updating it
on **disconnect** too, so it reflects last-*active* time, not just last-*connect* time.
"Online" is derived from an in-process `Map<userId, Set<deviceId>>` in `modules/relay/socket.ts`,
populated on connect/disconnect — **not** the Redis TTL heartbeat `docs/RETENTION.md` §2 originally
planned. That plan predates the observation that Socket.IO already tracks exactly this for free in a
single-process deployment (this app's actual Render deployment, per ADR-0001 — no clustering, no
Redis-backed Socket.IO adapter); a parallel Redis heartbeat would solve a horizontal-scaling problem
this project doesn't have yet. Revisit if/when this server ever runs as more than one process.

A user's online/offline transition broadcasts a new **`presence:update`** event (`{userId, online,
lastSeenAt}`) to every device of every *other* user who shares at least one conversation with them —
found via a plain `conversation_members` self-join, the same shape of query `attachMembers` already
runs for the members list. `GET`/`POST /conversations`'s existing `members` array (Phase 6 part 4
added `avatarUrl` there the same way) now also carries `online`/`lastSeenAt` per member, resolved
fresh on every call, as the initial snapshot a client renders before any live `presence:update`
arrives.

**Client state for all three is ephemeral, kept in `apps/web`, not `packages/sync-engine` or
`packages/local-store`.** None of `envelope:delivered`/`conversation:read`/`presence:update` write
anything to the local-first SQLite store — they're transient UI state, gone on reload, which is
exactly the same call already made for `sync-context.tsx`'s raw `socket` export ("for features that
need to speak directly to the server over events sync-engine doesn't own" — the doc comment already
there for device-linking). `apps/web/app/chat/[id]/page.tsx` listens directly on that socket.

## Consequences

- **A tick can under-report by one state if a device was offline at the exact moment of the
  transition**, permanently for that one message (delivery) or until a later message's read event
  arrives (read, self-healing). Documented, accepted — see Decision.
- **Reloading the Thread page loses all live tick/presence state** until new events arrive — ticks
  reset to "sent" (or whatever the initial members-array snapshot says for presence) on every mount.
  Acceptable for the same reason: this is deliberately not part of the durable local-first model.
- **Presence and read receipts both leak a small amount of activity metadata** (this user is online
  right now; this user has read up to message N) to anyone who shares a conversation with them — no
  different in kind from what any chat app with these features exposes, and still never touches
  message *content*.
- **A message that's paginated out of view (older history not currently loaded) never gets its tick
  upgraded** even if a read event for it arrives, since there's no loaded `TimelineEntry` to attach
  the status to. Low-impact: the message is off-screen either way, and scrolling back to it later
  just shows a stale-but-harmless tick.

## Alternatives considered and rejected

- **Persisting delivery/read state in Postgres** (a new column or table): rejected — see Decision.
  Would also need retention-model consideration (is a read receipt "content"? probably not, but it's
  one more thing `docs/RETENTION.md` would need to carry an opinion on for no real benefit here).
- **Per-message read tracking for groups**: rejected as materially bigger scope than what was asked —
  see Decision.
- **A Redis TTL presence heartbeat**, matching `docs/RETENTION.md` §2's original plan: rejected for
  now — see Decision. The reserved Redis TTL rows in that doc are updated to note this ADR instead.
