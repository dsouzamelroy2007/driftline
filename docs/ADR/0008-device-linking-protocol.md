# ADR-0008: Device Linking — Pairing Code & Signaling Protocol

**Status:** Accepted — 2026-08-26

## Context

ADR-0003 commits to WebRTC device-to-device history transfer as MVP scope (not stretch), with the
server relaying signaling only and never content, and an automatic, clearly-communicated fallback to
backup-file linking (ADR-0007) if the data channel can't establish. This ADR is the concrete
protocol: how two of one user's own devices — a new/empty one and one that already has history —
find each other and negotiate a WebRTC connection through the existing Socket.IO relay.

## Decision

**Roles:** the new/empty device is the **host** — it shows a code. The device that already has
history is the **source** — it scans or types that code and sends.

**Pairing session (Redis-only, never touches Postgres):** the host calls `POST /devices/link/start`
(authed) to mint an 8-digit numeric code, stored in Redis as `{ hostUserId, hostDeviceId, status:
"waiting", attempts: 0 }` with a 120-second TTL. **The same 8-digit code is used both as the QR
payload and the manual-entry fallback** — a single credential, not two — because the actual security
property that matters here is not code length, it's that **the source must already be authenticated
as the same account as the host**: the code is a rendezvous mechanism between two of *your own*
already-logged-in devices, not a proof of account ownership. A short code is fine as long as
guessing it is expensive enough, which the attempt cap below ensures.

**Join is protected by a hard per-session attempt cap (8), not by code length or a generic rate
limit alone.** `device-link:join` (a socket event, not REST — `@fastify/rate-limit` only covers
HTTP) validates, in order: the code exists and hasn't expired; the session is still `waiting` (not
already matched); the joining socket's `userId` matches `hostUserId`. Any failure — expired, already
matched, wrong account, or attempts exhausted — returns **the exact same generic "invalid or expired
code" message**; there is no oracle for which case it was, so the failure response itself can't be
used to narrow down a guess. Reaching 8 wrong-account attempts deletes the session outright rather
than letting it linger to expiry. A coarse per-socket-connection cap (5 attempts) on top of that is
defense in depth, not the primary control.

**Atomicity via WATCH/MULTI/EXEC, not Lua/EVAL.** Two source devices racing to join the same code
must not both succeed. The obvious tool is a Lua script (`EVAL`) for atomic check-and-set, but this
project's Redis is Upstash, and Upstash's `EVAL` support on managed/serverless plans has historically
been inconsistent — a live-verification risk not worth taking for a feature whose whole point is to
work reliably on $0-budget infra. Optimistic-locking with `WATCH`/`MULTI`/`EXEC` is plain
protocol-level Redis (`GET`/`SET`/`TTL`/`MULTI`/`EXEC`), the same command family every other Redis
usage in this codebase already relies on (magic-link's `SET ... EX` / `GETDEL`), so it carries no
new infra-compatibility risk.

**Signaling is a generic, validated relay — three new Socket.IO events**
(`docs/REALTIME_PROTOCOL.md` has the full contract): `device-link:join`, `device-link:signal`
(`{code, targetDeviceId, signal}` — `signal` is opaque SDP/ICE JSON the server never parses),
`device-link:cancel`. `device-link:signal` validates that the sender and the named target are
*exactly* the two device IDs recorded on that specific matched session — otherwise any authenticated
socket could use the relay to poke an arbitrary device's room. This reuses the existing
`deviceRoom()`/`io.to(...).emit(...)` fan-out pattern verbatim (`modules/relay/socket.ts`).

**STUN only, no TURN.** A public Google STUN server (free) is the only ICE server configured,
matching ADR-0003's explicit free-tier plan. If a data channel doesn't open within ~18 seconds of
the last received signal (the timeout resets on every signal, not just once at connect, so slow-but-
progressing ICE gathering isn't punished), the client aborts and shows the required fallback message
directing to backup export/import.

**No safety-number (SAS) verification.** A safety-number-style confirmation (deriving a short code
from both peers' connection fingerprints, shown on both screens for the user to visually match) was
considered — it would finally give the long-reserved `devices.publicKey` column a purpose. It's
deliberately not built here: WhatsApp's own device-linking QR flow doesn't do this either, because
the real trust boundary is physical possession of both already-logged-in devices plus a short-lived,
attempt-capped code, not an extra confirmation step. `devices.publicKey` stays reserved and unused;
this ADR is the record of *why* device linking didn't end up needing it, rather than a silent gap.

**Cleanup is TTL-first, not exhaustively race-proofed.** `device-link:cancel` is idempotent, callable
by either side, explicitly `DEL`s the session (not just a status flag) and notifies whichever other
device was involved. Beyond that, this protocol deliberately does **not** add proactive disconnect-
triggered cleanup for a host that vanishes while `waiting` — the 120-second TTL is the backstop, and
a source that joins an orphaned session simply hits its own connection timeout and sees the same
fallback UI. This is a documented, deliberate simplification (see Alternatives below), consistent
with this project's existing pattern of accepting narrow, low-consequence races rather than building
exhaustive state machines for them (e.g. `packages/local-store/src/repository.ts`'s own-send-vs-
incoming-envelope race, documented rather than eliminated).

## Consequences

- Device linking adds no new Postgres schema — it's Redis-only ephemeral state, consistent with it
  being a rendezvous mechanism, not a durable feature.
- The 8-digit code plus 8-attempt cap is materially stronger than a longer code with only a generic
  rate limit would be, because it bounds the *total* number of guesses against one session to a
  small constant regardless of timing, rather than a rate that a patient attacker could still exhaust
  the code space against over a very long TTL.
- Because there's no automated Redis integration test in this codebase yet (no other Redis-backed
  flow — magic-link included — has one; CI has no Redis service container), this protocol's pairing
  state machine is verified live/manually rather than in an automated Redis-backed test suite,
  matching how magic-link and OAuth were verified in Phase 2.

## Alternatives considered and rejected

- **Two separate credentials** (a long random token for the QR, a short derived code for manual
  entry): rejected as unnecessary complexity for the actual threat model — see "single credential"
  reasoning above.
- **Lua/EVAL for atomic join**: rejected due to Upstash EVAL-support risk (see above); WATCH/MULTI
  achieves the same atomicity guarantee with commands already proven to work against this project's
  Redis.
- **Proactive disconnect-triggered session cleanup**: considered, to close the "host vanishes while
  `waiting`" window immediately rather than waiting out the TTL. Rejected for this pass — it adds a
  reverse Redis index (`deviceId -> active code`) and reconnect-grace-period handling (a brief
  network blip shouldn't kill an otherwise-healthy session) for a failure mode that already degrades
  gracefully via the source's own connection timeout. Worth revisiting only if live verification
  shows it's a real annoyance, not a theoretical one.
- **SAS/safety-number verification**: see "No safety-number verification" above.
