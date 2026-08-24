# Design Review: Reference Architecture vs. Driftline

Source: [`design/reference-system-design.md`](../design/reference-system-design.md) — a system-design
interview study for a WhatsApp/Messenger-class chat system at 50M DAU. This document records what we
take from it, what breaks under our retention constraint, and what is over-engineered for a $0-budget
portfolio deployment. It is the input to ADR-0001, ADR-0002 and ADR-0003.

## Summary of the reference architecture (in our words)

The reference system splits into three tiers:

- **Stateless services** (auth, profile, discovery) behind a load balancer — ordinary
  request/response, horizontally scalable, no special handling.
- **One stateful service** — the chat service — because each client holds a long-lived WebSocket
  connection to a specific server. A **service discovery** layer (ZooKeeper) hands each client the
  right chat-server host at login and tracks server load so connections spread out.
- **Third-party integration** — push notifications for offline recipients.

Messaging is store-and-forward: a sender's message gets a **time-sortable unique ID** (Snowflake or
a local per-conversation counter — never `created_at`, since two rows can share a timestamp), is
written to a **permanent key-value store** (HBase/Cassandra), and is fanned out to a **per-recipient
message sync queue** — effectively an inbox per user. For small groups (WeChat's cap: 500 members),
the fan-out writes one copy per member; this is deliberately traded against the cost of a shared
read-fan-out model, and the reference doc is explicit that the trade only holds while groups stay
small. Multi-device sync rides on that same permanent store: each device tracks a
`cur_max_message_id` cursor and pulls anything newer belonging to it. Presence uses a heartbeat
(5s beat / 30s timeout in the example) specifically to avoid flapping the online indicator on flaky
connections, and fans out over a pub/sub channel per friend-pair — again explicitly degrading to
fetch-on-open once groups get large, because push-per-status-change doesn't scale to 100k-member
groups.

The whole design assumes message history is retained forever and the server can always answer "what
did I miss" by replaying from its own store. That assumption is the one thing we are not adopting.

## What transfers directly

These ideas are protocol-level and storage-model-agnostic — they hold regardless of whether the
server keeps history forever or purges on delivery:

- WebSocket as the single bidirectional real-time channel; plain HTTP/REST for everything that
  isn't real-time (auth, profile, device management).
- The stateless/stateful split, with the chat service as the only component holding per-connection
  state.
- A service-discovery contract between login and connection — even at our scale (one chat server),
  keeping the client code path "ask discovery, then connect" rather than hardcoding a host means we
  can add a second server later without a client release.
- Sortable, unique message/envelope IDs, generated server-side, never derived from wall-clock time
  alone.
- The per-recipient inbox / fan-out-on-write model for small groups — this is actually a *better*
  fit for us than for the reference system, because our fan-out targets are ephemeral
  (`EnvelopeTarget` rows that get deleted on ack) rather than permanent per-user message copies. We
  inherit the pattern without inheriting its long-term storage cost.
- Heartbeat-based presence with hysteresis, to prevent flapping on reconnect-heavy networks (relevant
  for us specifically because Render free tier + mobile networks means reconnects are common).
- Presence fan-out via pub/sub per relationship pair, with the same large-group degradation
  (fetch-on-open instead of push) — our group cap (100) is well under the point where this matters,
  but the pattern is worth keeping for headroom.
- The 100-member group cap and 100,000-character message cap as concrete, defensible limits rather
  than vague ones.

## What breaks under the retention constraint

The reference architecture's core data-layer assumption — permanent, queryable history in a
server-side KV store — is incompatible with R1–R7 (see the project brief). Specifically:

- **"Store chat history forever."** Our server never holds a delivered message body at all, let
  alone forever. The KV store in the reference design (HBase/Cassandra, sized for 60B messages/day)
  has no equivalent in our system beyond a transient `Envelope` table with a 30-day TTL and
  purge-on-ack.
- **`cur_max_message_id` catch-up.** This trick works only because the KV store is a permanent,
  append-only ledger a device can rewind into. We have no ledger to rewind into — once an envelope's
  last target acks, the row is gone. A returning device does not get "everything newer than my
  cursor"; it gets "everything currently pending for me," which is a fundamentally different (and
  smaller) guarantee. This is the single biggest divergence and gets its own ADR (ADR-0003).
- **New-device history replay.** In the reference model, logging in on a new device is a read against
  the permanent store. For us, a new device starts empty by design (R4) — there is nothing to replay.
  History must arrive via backup file or device-to-device transfer, both user-driven.
- **Random access / search over server data.** The reference doc explicitly calls out search,
  mentions, and jump-to-message as needing the data access layer's support. We cannot support any of
  that server-side, because the server never has the data at rest. All of it becomes a client-side
  local-store concern (R5) — this is why `packages/local-store` and `packages/sync-engine` exist as
  first-class shared packages rather than thin wrappers.
- **Read:write ratio reasoning.** The reference doc's storage choice is partly justified by a 1:1
  read/write ratio against a persistent store. That ratio doesn't apply to us in the same way — our
  server-side write is still real (an envelope row), but there is close to zero server-side "read
  history" traffic, because clients never query the server for anything older than their own
  pending inbox. Our read load is almost entirely local (on-device).

## What is over-engineered for free-tier, portfolio-scale deployment

The reference design targets 50M DAU. We are targeting hundreds of concurrent users on free
infrastructure. Several of its answers are correct at that scale and actively wrong at ours:

- **ZooKeeper for service discovery.** Running a ZooKeeper ensemble for one Render chat server is
  pure overhead — there's no leader election problem to solve when there is one node. We keep the
  *contract* (a `/discovery` endpoint the client calls before connecting) but back it with a Redis
  registry key with a heartbeat TTL, which is free, simple, and upgrades cleanly to something
  heavier if we ever run multiple chat servers.
- **HBase/Cassandra.** Both are built for horizontally-sharded, always-on, multi-node deployments —
  none of which we have room for on a free tier, and neither of which we need, since our durable
  data (users, devices, membership, the transient envelope queue) fits comfortably in a single
  Postgres instance at this scale. Neon's free tier is the right size for identity/routing metadata;
  it would be the wrong size for a permanent 60B-messages/day ledger, which is exactly the workload
  we're not building.
- **Global 64-bit Snowflake generator sized for many concurrent ID-generator nodes.** We adopt the
  *algorithm* (time-sortable, worker-ID-aware, unique) because it's cheap and correct, but we will
  run it embedded in the single chat server process rather than as a dedicated fleet — there is no
  coordination problem to solve with one writer.
- **Presence fan-out infrastructure sized for 100k-member groups.** Our group cap is 100. The
  fetch-on-open degradation the reference doc describes for huge groups is worth keeping as a
  documented fallback path, not something we need to build for MVP.

## Net effect

The reference architecture is a correct, well-reasoned answer to a different question ("how do you
retain and serve 50M DAU worth of permanent chat history") than the one we're answering ("how do you
build a fast, reliable relay that provably retains nothing"). We keep everything that's about
*getting a message from A to B correctly and in order* — that part of the reference design is not
scale-dependent, it's correctness-dependent, and it transfers whole. We replace everything that's
about *keeping the message around afterward* — that part is where the two systems' goals actually
diverge, and it's where ADR-0002 and ADR-0003 do the real work.
