# Realtime Protocol

Socket.IO contract for the relay core (Phase 3). Read `docs/RETENTION.md` first — every rule here
exists to serve that contract, not the other way around. Implementation:
`apps/server/src/modules/relay/socket.ts`.

## 1. Handshake auth

One token, one verification path, shared with HTTP (ADR-0004 §1): the client connects with

```js
io(SERVER_URL, { auth: { token: accessToken } });
```

`token` is the same short-lived access JWT used as the HTTP `Authorization: Bearer` header. The
server verifies it (`lib/tokens.ts`), then re-checks the device's `revokedAt` against the database
(`lib/principal.ts`'s `resolvePrincipal`, also used by `plugins/auth-plugin.ts`) — revocation takes
effect on the next connection attempt just like it does on the next HTTP request. A missing,
invalid, expired, or revoked-device token rejects the connection at `io.use()` — the client never
reaches `connection`.

There is no separate "authenticate" event after connecting; a successful handshake *is*
authentication.

## 2. Rooms

Each connected socket joins exactly one room: `device:${deviceId}`. Fan-out always targets this
room, never a user-wide room — a user's devices are independently addressed (ADR-0003 §1), since a
dormant laptop and an active phone have genuinely different target sets. Emitting to an
empty/offline room is a Socket.IO no-op; an offline device simply gets its backlog on its next
`connection` drain (§4).

## 3. On connect

In order, before any client-sent event is processed:

1. `lastSeenAt` is updated to now.
2. If the device's `dormantAt` was set (it had been excluded from fan-out per
   `docs/RETENTION.md` §5), the server emits **`dormancy:return`** (no payload) and clears
   `dormantAt`. The client turns this into the "dormancy return" gap-notice variant
   (`docs/RETENTION.md` §6 point 2) — the server does not compute what was missed, only that a gap
   is possible.
3. Every currently-`pending` `EnvelopeTarget` row for this device is drained and delivered as
   **`envelope:deliver`** events, ordered by `(conversationId, seq)`. This is the entire catch-up
   mechanism (ADR-0003 §2) — "what's pending for me right now," not a cursor replay. A brand-new
   device has no rows to drain and receives nothing; that's expected, not an error (ADR-0003 §4).

## 4. Events

### `message:send` (client → server, with ack callback)

```ts
socket.emit(
  "message:send",
  { conversationId: string, clientId: string, contentType: string, payload: string /* base64 */ },
  (response: { clientId: string; envelopeId: string; seq: number } | { error: string }) => { ... },
);
```

- `clientId` is chosen by the client (e.g. a local UUID) so it can reconcile its optimistic local
  write against the server-assigned `envelopeId`/`seq` once the ack callback fires.
- The server verifies conversation membership, then calls `sendEnvelope` (one transaction: bump
  `ConversationSequence`, insert the `Envelope`, fan out an `EnvelopeTarget` row to every active
  device of every member except the sender's own device).
- On success, the ack callback fires with `{clientId, envelopeId, seq}`, and every fanned-out
  target device (if currently connected) receives `envelope:deliver` on its `device:` room. An
  offline target gets it on its next connect-drain instead — the server does not retry delivery.
- On failure (not a member, invalid payload), the ack callback fires with `{error: string}` and no
  envelope is created.
- `payload` is opaque base64 the server never parses (`docs/RETENTION.md` §1) — `contentType` is
  metadata for the client to interpret it (`text/plain`, a reaction type, a receipt type, etc.; all
  are envelopes, none get bespoke retention treatment — ADR-0002 point 4).

### `envelope:deliver` (server → client)

```ts
socket.on("envelope:deliver", (envelope: {
  id: string; conversationId: string; senderId: string; senderDeviceId: string;
  seq: number; contentType: string; payload: string; createdAt: string;
}) => { ... });
```

Fired either immediately after a `message:send` fans out to an online device, or during the
connect-drain (§3) for anything that queued while the device was offline/unconnected. The client
cannot distinguish these two cases from the event itself and does not need to — both are "here is
an envelope you haven't acked yet."

### `envelope:ack` (client → server, no response)

```ts
socket.emit("envelope:ack", { envelopeId: string });
```

**Ack is its own message, never inferred** from a socket event, a read receipt, or presence
(`docs/RETENTION.md` §4). The client must emit this explicitly once it has durably stored the
envelope locally. This is the hot path: it triggers `ackEnvelope`, which flips this device's target
to `delivered` and — if that was the last pending target — deletes the envelope's payload and every
target row in the same transaction (`modules/relay/purge.ts`). There is no response event; acking
an unknown or already-acked envelope is a silent no-op (idempotent by design, so a client retry
after a dropped connection is always safe).

### `dormancy:return` (server → client, no payload)

See §3 point 2. Purely a signal; the client is responsible for rendering the gap notice.

### `device-link:join` (client → server, with ack callback)

```ts
socket.emit("device-link:join", { code: string }, (response: { hostDeviceId: string } | { error: string }) => { ... });
```

Device linking (ADR-0003 §4, `docs/ADR/0008-device-linking-protocol.md`) — a new/empty device (the
"host") calls `POST /devices/link/start` to mint an 8-digit pairing code, then the device that
already has history (the "source") emits this once it has that code (scanned or typed). The server
validates the code against a short-lived Redis session (never Postgres) and — on success — acks with
the host's `deviceId` and emits `device-link:peer-joined` into the host's room. Every failure case
(expired, already matched, wrong account, attempts exhausted) acks with the same generic
`{ error: "Invalid or expired code" }` — there is no oracle for which one it was.

### `device-link:peer-joined` (server → client, host only)

```ts
socket.on("device-link:peer-joined", (payload: { sourceDeviceId: string }) => { ... });
```

Tells the host which device just joined its pairing session, so it can start the WebRTC handshake
(it doesn't create an `RTCPeerConnection` before this — no peer to connect to yet).

### `device-link:signal` (bidirectional, no response)

```ts
socket.emit("device-link:signal", { code: string, targetDeviceId: string, signal: unknown });
socket.on("device-link:signal", (payload: { fromDeviceId: string; signal: unknown }) => { ... });
```

A generic, validated relay for WebRTC offer/answer/ICE-candidate exchange — `signal` is opaque JSON
the server never parses (ADR-0003: signaling only, never content). The server checks that the sender
and `targetDeviceId` are exactly the two device IDs recorded on that specific matched pairing
session before forwarding, so this can't be used as a general arbitrary-device messaging channel.

### `device-link:cancel` (client → server, no response)

```ts
socket.emit("device-link:cancel", { code: string });
```

Idempotent, callable by either the host or the source of a session. Deletes the Redis pairing
session immediately (not just a status flag) and emits `device-link:cancelled` to whichever other
device was involved in it, so its UI doesn't sit waiting for its own stall timeout.

### `device-link:cancelled` (server → client, no payload)

Fired at the device that didn't call `device-link:cancel`, telling it the other side backed out.

## 5. What the client must not assume

- **No replay.** There is no "give me everything since sequence N" event. A sequence gap (the next
  envelope's `seq` is more than 1 past the last one this device saw) is something the client detects
  and renders itself (`docs/RETENTION.md` §6 point 1) — the server has no "gap" concept to report
  beyond what it already purged.
- **No server-side history on reconnect** beyond whatever is still `pending` at that moment. A
  device that was offline past `RETENTION_WINDOW_DAYS` for a given envelope will simply never see
  it — this is correct, not a bug to work around (ADR-0002, ADR-0003).
- **No delivery guarantee beyond the 30-day window.** If every recipient device is dormant/offline
  for the entire window, the sweeper purges the envelope unconditionally at `expiresAt`
  (`docs/RETENTION.md` §3) — the sender does not get a distinct "expired without delivery" signal.
- **No server-side device-linking transfer.** `device-link:*` is signaling only — the actual history
  transfer happens over a direct WebRTC data channel between the two devices; the server never sees
  it, the same way it never sees a message body. A pairing session (Redis, 120s TTL) is deleted the
  moment it's matched-and-signaled to completion, cancelled, or expires — it is never a durable
  record of who linked with whom.
