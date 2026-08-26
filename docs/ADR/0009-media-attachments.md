# ADR-0009: Media Attachments — Retention-Synced R2 Storage

**Status:** Accepted — 2026-08-26

## Context

The last piece of the original Phase 6 scope. `docs/ROADMAP.md` classifies attachments broadly as
MVP+, not MVP — this ADR covers the "basic media" slice Phase 6's own sequencing already called for
(image attachments only: JPEG/PNG/WebP/GIF, 10MB cap), not the full attachment feature set
(captions-as-replies, voice notes, sticker packs stay future work). The one requirement that isn't
optional: this has to extend `docs/RETENTION.md`'s guarantee, not sit beside it. An attachment is
content the same way a text message body is content — an R2 object that outlived its envelope would
be a real hole in "the server never retains delivered content," not just an inconsistency.

## Decision

**An attachment is a specially-interpreted envelope payload, not a new entity.** `envelopes.payload`
is already opaque base64 the server never parses (`docs/RETENTION.md` §1). A media message's payload
is base64 JSON: `{ r2Key, size }` — a descriptor, not the image bytes. `message:send`, fan-out,
sequencing, ack, and the core purge mechanics need zero changes; they already treat payload as
opaque. Only two places become media-aware, both places that already inspect the envelope for other
reasons: purge (delete the R2 object too) and delivery (hand the recipient a way to fetch it).

**Upload is direct-to-R2 via a presigned PUT URL — bytes never pass through this server.** Free R2
egress plus this project's established $0-budget bandwidth reasoning (in-process sweepers over a
separate worker, Redis over a message queue). `POST /media/upload-url` (authed, rate-limited)
validates `{contentType, size}` against an allowlist and a 10MB cap, mints a key
(`attachments/{userId}/{uuid}`), returns a short-TTL presigned PUT URL. **Deliberately
conversation-agnostic**: the real authorization boundary is `message:send`'s existing
`isConversationMember` check, exactly the same as it already is for text — requiring a
conversationId at upload time would add a check this flow doesn't actually need, since an
uploaded-but-never-sent object is a harmless orphan (see Consequences), not a security hole.

**Download authorization rides on the existing fan-out delivery — no new endpoint.** `toWireEnvelope`
(`modules/relay/socket.ts`) is the one place that mints a presigned GET URL, injected into the wire
envelope only when the payload decodes to a media descriptor. The server *delivering this specific
envelope to this specific device* already is the authorization check — the same
`EnvelopeTarget`/room mechanism that governs all delivery — so there's no separate "give me a
download URL for key X" endpoint that would need its own membership lookup. This applies uniformly
to fresh delivery (`message:send`'s fan-out loop) and reconnect drain (`drainPendingTargets`), so a
device reconnecting days later gets a *freshly minted* URL, never a stale one from send time.

**Purge deletes the R2 object too, but only after the Postgres transaction has already committed.**
R2 is a network call, can't be transactional with Postgres, and must never roll back or block the
actual retention guarantee. `purgeEnvelopeIfComplete` (`modules/relay/purge.ts`) returns
`contentType`/`payload` alongside `purged`/`size`; its three callers (`ackEnvelope`, `revokeDevice`,
`sweepExpiredEnvelopes`) each `await` their transaction first, then call `cleanupPurgedMedia`
(`modules/media/media.service.ts`) — which extracts the R2 key (if any) and deletes it, catching and
logging any failure without surfacing it as a purge failure. By the time R2 cleanup runs, the
Postgres row is already gone; a stray R2 object is a secondary cleanup concern, not a broken
guarantee.

**The client downloads the actual bytes and persists them locally *before* acking** — the same
principle `packages/sync-engine` already applies to text ("ack only after the durable local write
commits"), extended one step. `handleEnvelopeDeliver`, on seeing `attachmentDownloadUrl`, fetches the
bytes (retried with backoff) and only proceeds to `insertIncomingEnvelope` + ack once that succeeds.
A permanent failure means the function returns without acking — the target stays `pending`
server-side and is redelivered, with a fresh URL, on this device's next reconnect. This is the
load-bearing property: once acked, the R2 object can be purged at any time, so a device must have
durably saved the bytes before telling the server it's safe to purge.

**`packages/local-store` gets one new nullable column, `attachment_payload`, on both
`timeline_entries` and `outbox`** — the downloaded (or, for the sender's own outgoing message,
already-locally-available) base64 image bytes, kept separate from `payload` (which stays exactly
what was received/sent over the wire — the small descriptor). A plain column addition, fully
expressible via ordinary `drizzle-kit generate`, unlike ADR-0007's FTS5 virtual table.

**Sender-side, the outbox row gets the attachment bytes immediately at compose time** — the sender
already has the file locally, so there's no reason to round-trip through its own upload+download to
render the optimistic bubble. Rendering (`MessageBubble`/`PendingBubble`) reconstructs a `Blob` from
the base64 and displays it via `URL.createObjectURL`, never a giant inline data URI.

## Consequences

- **Orphaned R2 objects are an accepted, documented risk.** If an upload succeeds but `message:send`
  never happens (client crash between the two), that object has no envelope to ever trigger its
  cleanup. No scheduled reconciliation sweep is built for this pass — free-tier R2 storage headroom
  is generous and the failure mode is rare and low-consequence, consistent with this project's
  existing pattern of documenting narrow races (e.g. `packages/local-store/src/repository.ts`'s own
  own-send-vs-incoming-envelope race) rather than building exhaustive state machines for them.
- **Size is claimed, not cryptographically enforced.** `POST /media/upload-url` validates what the
  client says it's about to upload; nothing stops a client from uploading more once it has a valid
  presigned URL. Acceptable given this is an authenticated action, not open upload — a spam/abuse
  concern for a future moderation pass, not a retention-model concern.
- **No thumbnails, no image dimensions in the descriptor.** Full image only, browser-constrained via
  CSS max-width/height. Real portfolio polish, not attempted this pass.
- **Backup export/import and device-linking transfer don't carry attachment bytes yet.** `ADR-0007`'s
  backup format and `ADR-0008`'s P2P transfer both predate this ADR and still only move
  `timeline_entries.payload` (the descriptor), not `attachment_payload`. A media message survives a
  backup restore or device link as a broken-image placeholder (`MessageBubble` handles a missing
  `attachmentPayload` gracefully — "Image not available" — rather than crashing), not the actual
  image. `packages/local-store`'s `ImportEntryInput` already accepts an optional `attachmentPayload`
  so this is a future wiring change in `packages/backup`, not another schema change, whenever it's
  worth doing.
- Retention accounting (`GET /me/storage`) already counts distinct envelopes, not bytes-by-type, so
  media envelopes are already reflected in the existing "you have N messages held on our servers"
  widget with no change needed there.

## Alternatives considered and rejected

- **Proxying uploads/downloads through this server**: rejected — burns Render's compute/bandwidth on
  a $0-budget deployment for no benefit, when R2 already supports direct presigned access designed
  for exactly this.
- **A separate `GET /media/:key/download-url` endpoint**, checked against conversation membership
  explicitly: rejected as redundant — the fan-out delivery mechanism already *is* that check, and a
  second, parallel authorization path is a second thing that could drift out of sync with the first.
- **Requiring a conversationId at upload time**, to validate membership before minting the upload
  URL: rejected — the real enforcement already happens at `message:send`, and requiring it earlier
  buys no additional security, only an extra round-trip and a conversation the user might not have
  picked yet at the moment they start selecting a file.
- **A scheduled orphan-object reconciliation sweep**: considered, rejected for this pass — see
  Consequences above.
