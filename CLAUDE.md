# Driftline — Agent Context

Read this first in every session. It's the current-state summary; the docs it links to are the
source of truth for anything detailed.

## What this is

A local-first, real-time chat app (WhatsApp-class UX) built as a public portfolio project, with the
defining property that **the server never retains a delivered message body** — it's a transport, not
an archive. Full constraint spec: see the original master prompt (kept in conversation history / can
be re-derived from `docs/RETENTION.md`, which is its formal contract).

- Positioning line: "Your messages live on your device, not ours."
- $0 budget, free-tier infra only.
- Portfolio-quality: code, docs, and commit hygiene are deliverables.
- Web (Next.js/Vercel) + Server (Fastify+Socket.IO/Render) + Mobile (Expo, Phase 10+), sharing logic
  via `packages/*`.

## Key decisions locked in Phase 0 (do not re-litigate without a new ADR)

- App name / repo: **driftline** (private GitHub repo under `dsouzamelroy2007`). "Ember" was
  considered and rejected — collides with the Ember.js trademark (Tilde Inc.), same industry.
- `RETENTION_WINDOW_DAYS = 30` is a **global constant** for MVP, not per-conversation
  ([ADR-0002](docs/ADR/0002-retention-storage-model.md)).
- **P2P device-to-device history transfer (WebRTC) is MVP scope**, not stretch — reverses the master
  plan's default. Fallback to encrypted-backup-file linking if WebRTC NAT traversal proves too costly
  in Phase 6 ([ADR-0003](docs/ADR/0003-multi-device-sync-without-server-history.md)).
- Stack: pnpm+Turborepo / Next.js+Vercel / Fastify+Socket.IO+Render / Neon+Drizzle / Upstash Redis /
  Cloudflare R2 / Resend / Expo+EAS / Sentry. Full rationale: [ADR-0001](docs/ADR/0001-stack.md).
- No commits should include `Co-Authored-By: Claude` or any Claude-related files — the user asked for
  this explicitly at project kickoff.
- Auth is device-scoped bearer tokens (JWT access + rotating opaque refresh token), not cookie
  sessions — chosen so web and the future Expo client share one auth path.
  [ADR-0004](docs/ADR/0004-auth-token-model.md).
- `packages/db` uses `drizzle-orm/node-postgres` (a `pg` Pool against the Neon connection string),
  not Neon's HTTP serverless driver — `apps/server` is a long-running Render process with no
  edge/serverless constraint, and the ack-triggered purge needs real transactions + row locking that
  `neon-http` cannot provide. [ADR-0005](docs/ADR/0005-postgres-driver.md).
- Web client-side storage is **SQLite Wasm, OPFS-backed** (via `sqlocal`), not Dexie/IndexedDB — so
  `packages/local-store` shares one Drizzle SQL schema/query layer with the future mobile package
  (Phase 10, `expo-sqlite`+Drizzle+FTS5). Both the browser and Node (test) backends go through
  `drizzle-orm/sqlite-proxy`, not a dedicated per-backend driver.
  [ADR-0006](docs/ADR/0006-local-store-engine.md).

## Where things live

```
design/reference-system-design.md   — the source system-design study (read-only reference)
docs/DESIGN_REVIEW.md               — what transfers/breaks/is-overkill from the reference doc
docs/RETENTION.md                   — the retention model contract (read before touching purge logic)
docs/REALTIME_PROTOCOL.md           — Socket.IO contract: handshake auth, every event, gap-notice signaling
docs/UI_DIRECTION.md                — IA, screens, nav, tokens, motion, retention-specific UX
docs/ROADMAP.md                     — phase sequence, MVP cut, open questions
docs/BACKUP_FORMAT.md               — the backup file format spec (packages/backup)
docs/SECURITY.md                    — auth/rate-limiting/CORS/crash-safety posture (Phase 8)
docs/RUNBOOK.md                     — operational reference: real incidents and their fixes (Phase 8)
docs/ADR/                           — 0001 stack, 0002 retention/storage, 0003 multi-device sync,
                                       0004 auth token model, 0005 Postgres driver,
                                       0006 local-store engine, 0007 backup format, 0008 device
                                       linking, 0009 media attachments, 0010 profile pictures,
                                       0011 presence and receipts
```
(`apps/`, `packages/` now exist as of Phase 1 — see below. `infra/` and the remaining `docs/*.md`
listed in the master plan's repo layout — `ARCHITECTURE.md`, `SYNC_MODEL.md`, `SCALE.md`,
`CASE_STUDY.md` — land in later phases.)

## Repo layout (as of Phase 6, part 2b)

```
apps/server/           Fastify + Socket.IO. Auth/device/discovery/conversations/users/storage REST
                        API, plus the Socket.IO relay: handshake auth, per-device rooms, message
                        send/deliver/ack, ack-triggered purge, expiry sweeper + dormancy sweep
                        (in-process intervals).
apps/web/               Next.js App Router — the full Phase 5 UI (auth, Inbox, Thread, Settings; see
                        below). COOP/COEP headers set (next.config.ts) for packages/local-store's
                        OPFS backend.
packages/db/            Drizzle schema (users, devices, oauth_accounts, conversations,
                        conversation_members, conversation_sequences, envelopes, envelope_targets)
                        + node-postgres client (ADR-0005) + migrations
packages/local-store/   On-device chat history — Drizzle SQLite schema/repository shared by two
                        backends (ADR-0006): node.ts (node:sqlite, tests, "./node" subpath export),
                        browser.ts (sqlocal/OPFS, "./browser" subpath export). Neither backend export
                        is re-exported from the package's main index — that index must stay
                        node:sqlite-free so apps/web can statically import it (Phase 5 caught this:
                        the main index used to re-export node.ts, which broke the browser bundle).
                        Tables: conversation_cursors (sync cursor only, not conversation metadata),
                        timeline_entries (messages + gap/history_start/dormancy_return markers,
                        local autoincrement id for pagination), outbox (offline send queue).
                        Phase 6 part 1 added importTimelineEntries (bulk-writes historical data from
                        a backup or a device-linking transfer, bypassing the live-sync seq-sequential
                        classifyAndAdvanceCursor path entirely — see docs/RETENTION.md's bulk-import
                        note) and listAllTimelineEntries (full unpaginated history, for export). Part
                        2a added searchTimeline (client-side FTS5 full-text search, docs/ADR/0006's
                        Phase 6 update) plus text-payload.ts (encode/decodeTextPayload, moved here
                        from apps/web since indexing needs the decode half at insert time) — the new
                        timeline_entries_fts virtual table is a hand-written migration (FTS5 isn't
                        expressible via drizzle-kit's schema diffing), populated in application code
                        since payload is base64 and no SQL trigger can decode it. Part 2b added an
                        attachment_payload column (both timeline_entries and outbox) — a normal
                        drizzle-kit-generated migration this time — holding the locally-cached base64
                        image bytes for a media message, kept separate from payload (which stays
                        exactly the small { r2Key, size } descriptor received/sent over the wire); see
                        docs/ADR/0009-media-attachments.md.
packages/sync-engine/   Drives local-store from docs/REALTIME_PROTOCOL.md. createSyncEngine({socket,
                        store, selfUserId, selfDeviceId}) — depends on socket.io-client directly
                        (no custom transport abstraction). All inbound socket events + outbox
                        flushes funnel through one serialized EventQueue so dormancy:return's
                        fan-out can't race a concurrently-arriving envelope:deliver. Phase 6 part 2b
                        added attachment-download.ts (retry+backoff fetch->base64) — a media
                        envelope's attachment is downloaded and durably stored locally *before*
                        insertIncomingEnvelope/ack fire; a permanent download failure skips both, so
                        the envelope stays pending server-side and is redelivered (fresh URL) on next
                        reconnect (docs/ADR/0009-media-attachments.md).
packages/backup/        Encrypted backup export/import + the device-linking P2P wire format
                        (docs/ADR/0007, docs/BACKUP_FORMAT.md). Web Crypto only (PBKDF2-SHA256 ->
                        AES-256-GCM), no crypto dependency — works identically in the browser and
                        Node (tests), same reasoning as ADR-0006. Depends on @driftline/local-store
                        the way sync-engine does. exportBackup/importBackup (file format, passphrase-
                        encrypted) and collectBackupPayload/applyBackupPayload/chunkBackupPayload/
                        createChunkReassembler (the shared plaintext model + P2P chunking adapter,
                        no passphrase layer — the WebRTC data channel is already DTLS-encrypted).
packages/ui-tokens/     Design tokens (docs/UI_DIRECTION.md §5) + Tailwind preset
packages/tsconfig/      Shared strict base tsconfig
packages/eslint-config/ Shared flat ESLint config + Prettier config
```
Root scripts (`pnpm dev|build|lint|typecheck|test`) all delegate to Turborepo. CI
(`.github/workflows/ci.yml`) runs the same four tasks on every push to `main`, against a
`postgres:16` service container (relay integration tests need a real Postgres — see
`docker-compose.yml` for the equivalent local setup, `README.md` for the exact commands).

`apps/server` env vars: see `.env.example` at repo root — copy to `.env` (gitignored) with real
Neon (`DATABASE_URL`), Upstash (`REDIS_URL`, must be the `rediss://` protocol string, not the REST
URL), Resend (`RESEND_API_KEY`), a GitHub OAuth App (`GITHUB_CLIENT_ID`/`SECRET`), a generated
`JWT_SECRET`, plus `RETENTION_WINDOW_DAYS`/`DEVICE_DORMANCY_DAYS` (both default 30). `apps/web`
needs `NEXT_PUBLIC_SERVER_URL` (the server's own HTTP + Socket.IO origin). Run
`pnpm --filter @driftline/db db:migrate` once after schema changes.

Auth API (all under `apps/server`, see ADR-0004 for the token model):
`POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`,
`PATCH /me` (update `displayName`, and since Phase 6 part 4 an optional `avatarUrl` — an r2Key from
the endpoint below, or `null` to remove; never a client-supplied external URL), `POST
/me/avatar/upload-url` (authed, rate-limited — mints a presigned R2 PUT URL for a profile photo,
5MB cap, `docs/ADR/0010-profile-pictures.md`), `GET /users/lookup?email=` (exact-match lookup, powers Phase 5's
New Chat), `GET /me/storage` (`{envelopeCount, oldestExpiresAt}` — the "you currently have N
messages held on our servers" widget, counts distinct envelopes via `envelope_targets` joined to
`envelopes`, never touches payload), `GET /devices`, `DELETE /devices/:id` (revoke — now also
synchronously purges the device's pending envelope targets, see below), `POST /devices/link/start`
(authed, rate-limited — mints an 8-digit device-linking pairing code, Redis-only state, 120s TTL;
see Relay note below), `POST /media/upload-url` (authed, rate-limited, conversation-agnostic on
purpose — mints a presigned R2 PUT URL for an image attachment, allowlisted content types, 10MB cap;
see `docs/ADR/0009-media-attachments.md`), `GET /discovery`
(service-discovery contract, Redis heartbeat registry), `POST /auth/magic-link/request`,
`POST /auth/magic-link/verify` (Redis-backed, single-use via `GETDEL`), `GET
/auth/oauth/github/start`, `GET /auth/oauth/github/callback` (redirects to
`${WEB_ORIGIN}/auth/callback#accessToken=...&refreshToken=...`, handled by
`apps/web/app/auth/callback/page.tsx` since Phase 5). Rate-limited (`/auth/register`, `/auth/login`,
`/auth/magic-link/request`, 20/min, Redis-backed). Not built: Google OAuth (same pattern as
GitHub's `oauth/github.service.ts`, deferred).

Relay (Phase 3, `apps/server/src/modules/relay/`, full contract in `docs/REALTIME_PROTOCOL.md`):
`POST /conversations`, `GET /conversations` (direct + group, ≤100 members; each conversation now
also carries a `members: {userId, displayName, avatarUrl, online, lastSeenAt}[]` array, added in
Phase 5 since the web client has no other way to render a conversation's name — `conversations`
itself still has no `name` column, so a group's display name is derived client-side by joining
member names; `apps/web/lib/conversation-name.ts` — `avatarUrl` added Phase 6 part 4, resolved
server-side the same way `/me`'s is; `online`/`lastSeenAt` added Phase 6 part 5 as a presence
snapshot, see below). Socket.IO: handshake auth via the same access-token
verification path as HTTP; `message:send` (ack-callback with `{envelopeId, seq}`), `envelope:deliver`
(server → client), `envelope:ack` (client → server, the hot path that triggers the transactional
purge), `dormancy:return` (gap-notice signal on reconnect). Phase 6 added device linking
(`docs/ADR/0008-device-linking-protocol.md`, full event contract in `docs/REALTIME_PROTOCOL.md`):
`device-link:join` (source device, ack-callback), `device-link:peer-joined` (server → host),
`device-link:signal` (bidirectional, opaque SDP/ICE relay, validated against the matched pairing
session), `device-link:cancel`/`device-link:cancelled` — all backed by `modules/devices/device-link.
service.ts`'s Redis pairing session (WATCH/MULTI for atomic join, not EVAL — Upstash EVAL support is
unreliable), never Postgres, and the actual history transfer happens over a direct WebRTC data
channel the server never sees (STUN-only, no TURN; 18s no-signal timeout falls back to backup
export/import). Purge paths: ack-triggered (same transaction, `SELECT ... FOR UPDATE` serializes
concurrent acks on one envelope — see `modules/relay/purge.ts`), expiry sweeper, and device
revocation, all logging `envelope_purged_total{reason}` with envelope ID + size only. Expiry sweeper
and dormancy sweep run as in-process `setInterval`s (every 5 min), not a separate
`infra/scripts/sweeper` — revisit only if this needs to move out-of-process (Phase 8/9).
Phase 6 part 2b added media attachments (`docs/ADR/0009-media-attachments.md`): a new
`modules/media/` (upload-URL endpoint, `tryExtractR2Key`/`cleanupPurgedMedia`) and
`lib/r2-client.ts` (`@aws-sdk/client-s3` presigned PUT/GET/delete). All three purge paths
(ack/sweeper/revocation) now delete a purged envelope's R2 object too, post-commit only — see
Status below. Phase 6 part 5 added presence/receipts (`docs/ADR/0011-presence-and-receipts.md`):
`envelope:delivered` (server → sender's devices), `conversation:read` (bidirectional, direct
conversations only), `presence:update` (server → a user's conversation partners) — a new
`modules/presence/` (`getActiveDeviceIds`/`getConversationPartnerUserIds`/
`getActiveDeviceIdsForUsers`), `isUserOnline` exported from `modules/relay/socket.ts` (in-process
`Map<userId, Set<deviceId>>`, not Redis — supersedes the heartbeat `docs/RETENTION.md` §2 originally
planned), and `devices.lastSeenAt` now updated on disconnect as well as connect. All three are
live-only, no persistence — see ADR-0011 for the accepted-gap reasoning. Not built: typing
indicators (deliberately out of Part 5's scope, see ADR-0011), thumbnails, generic (non-image) file
attachments.

## Working agreement reminders

- One phase at a time; work directly on `main` — no phase branches, no PRs (user preference, set
  after Phase 1: solo portfolio repo, review overhead isn't worth it). CI on `main` still gates via
  `ci.yml`; if a push breaks CI, fix forward with the next commit rather than reverting.
- Write an ADR for every non-obvious choice and every divergence from the reference architecture.
- Never write server code that reads/logs a message body — if you catch yourself doing it, stop and
  say which requirement is pushing you there.
- Ask before: paid services, heavyweight deps, schema changes after Phase 3, anything needing the
  user's credentials (give exact click-by-click steps, don't ask for tokens/passwords directly).
- Update this file at the end of every phase.

## Status

**Phase 0 (Discovery, Design & Retention Model): complete and reviewed.** Pushed to `main` at
`3b7f874`. GitHub repo `dsouzamelroy2007/driftline` (private) created, `gh` authenticated, `origin`
wired.

**Phase 1 (Monorepo Foundation & DX): complete, merged to `main`** at `a8bcf1c`. pnpm+Turborepo
workspace scaffolded per `docs/ADR/0001-stack.md`.

**Phase 2 (Identity, devices & service discovery): complete on `main`.** `packages/db`
(Neon+Drizzle schema for `users`/`devices`/`oauth_accounts`) and the full auth surface in
`apps/server` — password, magic-link (Resend), and GitHub OAuth — plus device registry and
service discovery, all verified end-to-end against real Neon, Upstash, Resend, and a live GitHub
OAuth consent flow. Bugs found and fixed during verification: auth responses were leaking
`passwordHash`/`refreshTokenHash` (fixed via `lib/serialize.ts`), and the global error handler was
masking `@fastify/rate-limit`'s 429s as 500s (fixed by respecting any thrown error's own
`statusCode`, not just the app's `HttpError` class). Full pipeline (lint/typecheck/test/build, 12
unit tests) green. Google OAuth deliberately not built — same pattern as GitHub's, left as a small
follow-up whenever it's wanted.

**Phase 3 (Relay core: store-and-forward, fan-out & retention): complete on `main`.**
`Conversation`/`ConversationMember`/`ConversationSequence`/`Envelope`/`EnvelopeTarget` schema, the
Socket.IO relay (handshake auth, per-device rooms, `message:send`/`envelope:deliver`/`envelope:ack`,
reconnect drain), and every purge path from `docs/RETENTION.md` §7's checklist: ack-triggered
(transactional, `FOR UPDATE`-locked to be race-safe under concurrent acks), expiry sweeper, dormancy
sweep, and revocation. Exit gate met: `apps/server/src/modules/relay/retention.integration.test.ts`
proves zero message bodies survive after all parties ack (plus partial-ack, concurrent-ack, expiry,
and revocation cases) against a real Postgres — verified twice, once via the integration test suite
and once by hand over live Socket.IO connections with a direct DB check afterward. Required a
foundational fix first: `packages/db` was on Neon's HTTP driver, which cannot do transactions at
all — switched to `drizzle-orm/node-postgres` ([ADR-0005](docs/ADR/0005-postgres-driver.md)). CI now
runs relay integration tests against a `postgres:16` service container; `docker-compose.yml` gives
the same locally. Full pipeline (lint/typecheck/test/build, 17 tests) green — see
`docs/RETENTION.md` §7's "Verification" note for the itemized proof against the retention contract.
Bugs found and fixed while running the full pipeline against the new tests (not present in the
relay logic itself, but would have broken CI): Turborepo's strict env mode was silently stripping
`DATABASE_URL` before it reached the test task (fixed via `turbo.json`'s task-level `env`
declaration — this is the first test suite in the repo to read `process.env` directly, so nothing
had exposed the gap before), and the existing bcrypt password test was timing out at the default
5s under the CPU contention of the now-larger full pipeline (fixed by raising
`vitest.config.ts`'s `testTimeout`, unrelated to bcrypt's cost factor itself).

**Phase 4 (Client sync engine & local-first store): complete on `main`.** `packages/local-store`
(Drizzle SQLite schema + repository, two backends sharing every line of query code — `node:sqlite`
for tests, `sqlocal`/OPFS for the browser, both via `drizzle-orm/sqlite-proxy`) and
`packages/sync-engine` (drives the store from `docs/REALTIME_PROTOCOL.md`: gap/history-start
classification on `envelope:deliver`, `dormancy:return` fan-out to every known conversation, an
offline outbox with clientId reconciliation, ack only after the durable local write commits). The
web store engine choice `ADR-0001` deferred to this phase is settled:
[ADR-0006](docs/ADR/0006-local-store-engine.md). No UI yet (Phase 5) — headless packages, tested
directly. 24 tests across both packages green, including the property `ADR-0003` explicitly
requires (two independent stores fed divergent delivery streams both stay self-consistent, without
converging — divergence is correct, not corruption) and a failure-path test proving a rejected
local write never triggers an `envelope:ack`. Verified a second way, live: a headless-Chromium
check (Playwright + Vite, COOP/COEP headers) drove the actual `browser.ts` through a real page
reload and confirmed a written row survives in OPFS — this caught a real bug the Node suite's
always-fresh `:memory:` databases couldn't (`applyMigrations` was silently re-running every
migration on every store open because a raw `sql` query's row shape was read wrong; see ADR-0006),
now fixed with a matching Node-side regression test using a real file-backed database. Also caught
during implementation: `drizzle-orm/node-sqlite` (assumed available going into this phase) only
exists in unreleased `1.0.0` release candidates, not any stable release — both backends were
unified on `drizzle-orm/sqlite-proxy` instead, recorded in ADR-0006 rather than silently patched
over. `apps/web/next.config.ts` now sets the COOP/COEP headers the OPFS backend needs, ahead of
Phase 5 mounting a real page on top of this.

**Phase 5 (Web client, portfolio-grade UI): complete on `main`.** The first real UI: full auth
(register, login, magic link, GitHub OAuth callback, first-run onboarding), Inbox (conversation
list with locally-computed preview/unread badge), Thread (message list with gap/history-start/
dormancy-return notices, composer, offline outbox rendering, an ARIA live region for incoming
messages), New Chat/New Group (email lookup), Conversation settings (member list; mute/pin are
local-only UI state, no server support yet), Settings (profile edit, Device manager with revoke +
dormancy countdown, the server-storage widget, Data & privacy with the retention transparency
table), and public `/privacy` + `/terms`. Scoped deliberately narrower than `docs/UI_DIRECTION.md`'s
full screen inventory — per `docs/ROADMAP.md`'s own phase sequencing, backup export/import, QR/
WebRTC device linking, and client-side search all stay in Phase 6, not this one.

Required four small additive server endpoints beyond what Phase 2–3 already had (all read-mostly,
no schema changes — see the Auth API / Relay notes above for the exact shapes): `PATCH /me`,
`GET /users/lookup`, `GET /me/storage`, and `GET /conversations` gaining a `members` array.

Verified live against real Postgres + local Redis + two independent headless-Chromium browser
contexts (Playwright), not just the unit suite: registered two accounts, started a direct chat,
sent messages both directions over the real Socket.IO relay, confirmed OPFS survives a full page
reload (the actual point of Phase 4), confirmed the unread badge and cross-device delivery both
work, and confirmed a device's own logout+login reuses one device row rather than minting a new one
each time. That last check caught a real bug — see below. Full pipeline (lint/typecheck/test/build,
57 tests) green.

Three real bugs found and fixed during this verification, none caught by the unit suite alone:
1. `packages/local-store`'s main index re-exported `createNodeLocalStore` (from `node.ts`, which
   imports `node:sqlite`) right alongside the browser-safe schema/repository exports. Harmless for
   Node consumers, but the instant `apps/web` (or `packages/sync-engine`, which imports the main
   index for its shared repository functions) got bundled for the browser, webpack tried to resolve
   `node:sqlite` and failed. Fixed by giving `node.ts` its own `"./node"` subpath export (mirroring
   `"./browser"`) and dropping it from the main index — the main index is now genuinely
   platform-agnostic, which is also what ADR-0006 already wanted for Phase 10.
2. The client was minting its own `crypto.randomUUID()` as a device id and reusing it forever,
   assuming the server would treat it as that device's permanent identity. It doesn't:
   `upsertDevice` (`auth.service.ts`) only *reuses* a device row when the id it's given matches an
   *existing* row's own id — on first creation it always mints its own server-side uuid and ignores
   whatever id the client proposed. A self-generated id that never actually matches a real row
   silently minted a brand-new device on every single login. Fixed by persisting the
   *server-returned* `device.id` after every successful auth (register/login/magic-link; OAuth's
   redirect doesn't include a `Device` object, so that path decodes the unverified `deviceId` claim
   already present on the access token instead) and sending that back on every subsequent call.
3. The API client unconditionally set `Content-Type: application/json` even on bodyless requests
   (`POST /auth/logout`, `DELETE /devices/:id`) — Fastify's JSON body parser rejects an empty body
   sent with that header (`FST_ERR_CTP_EMPTY_JSON_BODY`, a 400). Fixed by only setting the header
   when a body is actually present.

Known gap, deliberately not fixed this phase: self-revoking your *own* currently-active device
(as opposed to another device from a different session) correctly cuts the session per ADR-0004,
but the client doesn't yet catch the resulting failed reconnect/refresh and force a clean logout —
it surfaces as console noise rather than a graceful redirect to `/login`. Low priority (an unusual
thing for a real user to do to themselves) but worth a small follow-up.

**Phase 6, part 1 (Backup export/import & device linking): complete on `main`.** Both of the two
"coming soon" stubs Phase 5 left in the thread's gap-notice buttons are now real. New package
`packages/backup` (Web Crypto only — PBKDF2-SHA256 → AES-256-GCM, no crypto dependency) implements
encrypted backup file export/import and the plaintext model shared with device-to-device transfer
(`docs/ADR/0007-backup-format.md`, `docs/BACKUP_FORMAT.md`). Device linking
(`docs/ADR/0008-device-linking-protocol.md`) adds a Redis-only pairing-session flow — an 8-digit
code doubling as both the QR payload and the manual-entry fallback, capped at 8 wrong-account
attempts (not brute-forceable via length alone), atomic join via `WATCH`/`MULTI` (not `EVAL` —
Upstash's Lua-scripting support is unreliable) — plus three new Socket.IO events
(`device-link:join/signal/cancel`, full contract in `docs/REALTIME_PROTOCOL.md`) that relay WebRTC
offer/answer/ICE between the two devices, STUN-only, with an 18-second no-signal timeout that falls
back to backup export/import per ADR-0003. New web UI: `/settings/backup` (export/import, with an
unsent-outbox warning before import) and `/settings/link-device` (QR host/scan via `qrcode` +
`BarcodeDetector`/`jsQR`, plus manual code entry), and the backup-nagging banner from
`docs/UI_DIRECTION.md` §8. Media/attachments (R2) and client-side search stay out of scope for this
pass — a separate follow-up — per an explicit scoping decision made with the user before starting.

`packages/local-store` gained `importTimelineEntries` (bulk-write, bypassing the live-sync
seq-sequential `classifyAndAdvanceCursor` path entirely — see `docs/RETENTION.md`'s bulk-import
note) and `listAllTimelineEntries` (full unpaginated history, for export). Automated tests cover
both new packages plus the server's REST/schema layer; the Redis-backed pairing-session state
machine itself has no automated test — consistent with this codebase's existing pattern (no other
Redis-backed flow, including magic-link, has one either; there's no Redis service container in CI)
— and was instead verified live, alongside everything else.

Verified live against the real dev Neon + Upstash instances (the same ones `pnpm dev` already used),
with two-and-three-way headless-Chromium Playwright sessions actually completing both flows
end-to-end: exported an encrypted backup from one device, imported it on a freshly-logged-in second
device for the same account, and confirmed the message reappeared; separately, linked a brand-new
device to an existing one carrying real history over an actual WebRTC data channel (STUN, no TURN)
via the manual-code path, transfer completing in under 2 seconds. Two real bugs found and fixed
during this pass, neither caught by the unit suite:

1. `useDeviceLinkHost`'s `start()` (`apps/web/lib/device-link-client.ts`) refused to run at all
   unless the sync socket was already connected — but minting a pairing code is a plain REST call
   that never touches the socket; only the *listener* for a peer joining needs it, and that's wired
   up separately and re-subscribes whenever the socket becomes ready. A user who opened
   `/settings/link-device` and clicked "Show my code" quickly (a very normal thing to do) got
   silently nothing. Fixed by dropping the unnecessary guard; the analogous (and legitimate, since
   `join()` really does need to emit on the socket immediately) guard on the source side now at
   least surfaces "Still connecting — wait a moment and try again" instead of silently no-op'ing.
2. Live verification itself first mis-diagnosed the same symptom as an app bug, because the test
   script used full-page `goto()` for in-app navigation — which, unlike a real `<Link>` click, tears
   down and re-mounts every provider (socket, local-store) on every navigation. Switching the script
   to click real in-app links resolved it; worth noting here because it's the kind of false-negative
   this project's "live verification, not just unit tests" pattern exists to catch even when the
   live check's own harness is initially wrong.

Full pipeline (lint/typecheck/test/build) green per-package; the one failure seen running the
complete `turbo run lint typecheck test build` in a single pass was `apps/server`'s bcrypt password
test timing out under the CPU contention of everything building/testing at once simultaneously —
already a known, previously-worked-around flake (see Phase 3's notes), reproduced again here but not
caused by this phase's changes, confirmed by every package passing cleanly in isolation.

**Phase 6, part 2a (Client-side full-text search): complete on `main`.** Local FTS5 search over this
device's own message history — entirely client-side, no server involvement at all
(`docs/DESIGN_REVIEW.md`'s original "search becomes a local-store concern" call, now actually built).
Two facts were verified empirically before committing to the design, not assumed: FTS5 works on both
local-store backends (`node --experimental-sqlite` spike for `node:sqlite`; a headless-Chromium
Playwright check against a minimal Vite page for `sqlocal`'s Wasm build), and `.returning()` on
insert already works cleanly through `drizzle-orm/sqlite-proxy` (the existing `node.spike.test.ts`).
A new `/search` page (global, not per-conversation, matching `docs/UI_DIRECTION.md`'s screen
inventory naming), debounced, with FTS5 `snippet()`-highlighted results and search-as-you-type
prefix matching.

Security note worth recording: FTS5's `snippet()` output was initially going to use `<mark>`/`</mark>`
as its highlight tags, rendered via `dangerouslySetInnerHTML` — caught before implementation that
this would be a real XSS hole, since a message body is arbitrary user text that could itself contain
literal HTML. Fixed by using unprintable control characters (SOH/STX) as the snippet delimiters
instead and rendering the highlight as a real React `<mark>` element after a plain string split —
never `dangerouslySetInnerHTML` on message content, full stop.

One real bug found and fixed during verification, not caught until the full monorepo pipeline ran
(isolated per-package runs all passed first): the search-indexing hook
(`indexMessageForSearch`) let a base64 decode failure throw straight out of the same transaction as
the actual message insert — `packages/sync-engine`'s own test fixtures use plain non-base64
placeholder strings for `contentType: "text/plain"`, which crashed `insertIncomingEnvelope` entirely,
not just search indexing. Fixed by catching the decode failure locally: a malformed payload just
means that one message isn't searchable, never a failed insert — search must not be able to take
down message delivery. A regression test now covers this. Full pipeline (lint/typecheck/test/build)
green per-package; the one failure in a single combined `turbo run` was a `.next/types` race between
the long-running dev server and the production build sharing the same output directory — confirmed
by immediately re-running the same checks in isolation, not a code issue.

**Phase 6, part 2b (Media attachments via Cloudflare R2): complete on `main`.** The last piece of
the original Phase 6 scope. Image attachments (JPEG/PNG/WebP/GIF, 10MB cap) — scoped deliberately
narrower than MVP+'s full attachment feature set (`docs/ROADMAP.md`), matching what Phase 6's own
sequencing called "media." Full design in `docs/ADR/0009-media-attachments.md`; the short version:
an attachment is a specially-interpreted envelope payload (`{ r2Key, size }`, base64 JSON — still
opaque to the server), not a new entity, so `message:send`/fan-out/sequencing/ack needed zero
mechanical changes. Upload is a direct-to-R2 presigned PUT (bytes never touch this server); download
authorization rides on the existing fan-out delivery with zero new endpoints — `toWireEnvelope`
mints a presigned GET URL only when delivering to the device that's actually a legitimate recipient,
which is already the only check that matters. All three purge paths (ack/sweeper/revocation) now
delete a purged envelope's R2 object too, strictly *after* their Postgres transaction has committed
— R2 can't be transactional with Postgres and must never block or roll back the actual retention
guarantee. Client-side, the attachment is downloaded and durably saved locally *before*
insert-and-ack, mirroring the exact reasoning text messages already used ("ack only after the
durable local write commits") one step further: once acked, the R2 object can be purged at any time.

Caught and fixed before it shipped: the first snippet/highlight design isn't part of this feature,
but a closely-related real find is — while building the composer's file-picker flow, confirmed via
code review (not live testing) that `MessageBubble`'s image branch needed an explicit "Image not
available" fallback for a missing `attachmentPayload`, since `packages/backup`/device-linking
(ADR-0007/0008, both predating this ADR) don't carry attachment bytes through backup restore or P2P
transfer yet — a documented, accepted gap (ADR-0009's Consequences), not a silent crash risk.

One real omission found and fixed *live*, not by the unit suite: my own first round of click-by-click
R2 setup instructions to the user only specified `AllowedMethods: ["PUT"]` in the bucket's CORS
policy, missing that the *download* side also fetches directly browser→R2 (a GET), which needs its
own CORS allowance. Live verification caught this immediately as a real, reproducible CORS console
error on the recipient's side — fixed by updating the instructions (and the bucket) to allow both
`PUT` and `GET`, then re-verified clean. Live-verified end-to-end against the real R2 bucket and two
independent headless-Chromium contexts: a real (if tiny) PNG uploaded by one account, received and
correctly rendered by the other, and — the actual point of this whole design — confirmed via the
server's own structured logs that `envelope_purged_total{reason:"ack"}` and
`media_object_purged_total` fired back-to-back the instant the recipient acked, proving the R2
object and the Postgres row are purged together, not just in theory.

Full pipeline (lint/typecheck/test/build) green per-package across all four touched packages
(`apps/server`, `packages/local-store`, `packages/sync-engine`, `apps/web`).

Also still open: the presence/typing/read-receipt gap and the deferred custom-group-name schema
change noted in Phase 5, revisit if either becomes worth prioritizing. Phase 6 (all parts) is now
complete.

## Phase 6 parts 3–6 (from a user manual test pass, 2026-08-27) — ALL DONE

The user ran the full Phase 6 feature set live (per the walkthrough above) and reported six items,
now all closed as of Part 6 completing 2026-08-27. Sequenced into Phase 6 parts 3–6
(`docs/ROADMAP.md`) rather than a new phase — see that doc for why.

1. **CLOSED, not a code defect (2026-08-27).** The leading hypothesis was confirmed: the running
   `pnpm dev` process was two days stale (started 2026-08-25, long since stopped responding on any
   port at all by the time this was checked). A genuinely fresh `pnpm dev` plus a two-account
   Playwright run (register both, direct chat, real image upload/download over the live R2 bucket)
   rendered the attachment correctly on both sender and receiver — no "Unsupported message", no
   allowlist mismatch, `media_object_purged_total` fired on ack exactly as designed. No app-logic
   change was needed for the reported symptom itself.

   Getting to that fresh restart surfaced a real, separate bug along the way, now fixed: Turborepo
   2.x defaults to strict env mode, and `turbo.json`'s `dev` task never declared an env
   passthrough, so `pnpm dev` from any clean shell silently dropped every custom env var
   (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `RESEND_API_KEY`, `GITHUB_CLIENT_ID/SECRET`, all
   four `R2_*` vars) and `apps/server` crashed at startup with a wall of zod "Required" errors —
   easy to misread as a broken `.env` rather than a turbo config gap. Fixed by setting
   `"envMode": "loose"` in `turbo.json`. That in turn exposed a second, smaller issue: with the
   full shell env now reaching every task, `apps/web`'s `next dev` started picking up the
   server's own `PORT=4000` from `.env` and binding there instead of 3000, colliding with the
   actual server. Fixed by pinning `apps/web/package.json`'s `dev`/`start` scripts to `-p 3000`
   explicitly, rather than renaming the server's `PORT` var — `apps/server` deploys to Render,
   which sets `PORT` automatically by platform convention, so that name needs to stay exactly
   `PORT` for when deployment is actually wired up. Net effect: a clean `pnpm dev` from a cold
   shell now works end-to-end, which it did not reliably do before this fix.

Items 2–6 are now sequenced as **Phase 6, parts 3–6** — full rationale and ordering in
`docs/ROADMAP.md`'s "Phase 6, parts 3–6" section, not repeated here. Short form:

2. **Part 3 — DONE (2026-08-27).** `attachmentPayload` now flows through `packages/backup`'s
   `BackupEntry`/`collectBackupPayload`/`applyBackupPayload` (`packages/backup/src/serialize.ts`) —
   optional on both read and write, since a device may not have the bytes locally (already purged,
   or never downloaded). `chunker.ts` needed no changes at all: it carries `BackupEntry` opaquely,
   so device-linking's P2P transfer got this for free the moment `serialize.ts` did. Closes the gap
   ADR-0009's Consequences section documented; `docs/BACKUP_FORMAT.md` §2 updated with the new field.
   Unit-tested (encrypted file round-trip in `roundtrip.test.ts`, chunk/reassemble in
   `chunker.test.ts`) and live-verified: real two-device Playwright run — image sent over the live
   R2 bucket on device A1, backup exported and encrypted, imported on a freshly-logged-in A2 (same
   account) — rendered correctly, no "Image not available". Device-linking's WebRTC path wasn't
   separately live-verified this round (same unchanged plaintext model, already covered by the
   chunker unit test), only the file export/import path.
3. **Part 5 — DONE (2026-08-27).** Read receipts, delivery/read ticks, last seen. Written up as
   [ADR-0011](docs/ADR/0011-presence-and-receipts.md) — short version: everything here is live-only,
   no new Postgres/Redis persistence (a device offline at the exact moment a tick/read/presence
   transition happens just misses it — accepted, documented, same "narrow race" posture as several
   earlier ADRs). Three new Socket.IO events (`docs/REALTIME_PROTOCOL.md`): `envelope:delivered`
   (server → every one of the sender's own active devices, fired once every *recipient* target has
   acked — checked independently of full purge, since purge also waits on the sender's own other
   devices, which would otherwise make the tick rarely fire for multi-device accounts);
   `conversation:read` (bidirectional, direct conversations only — a `throughSeq` watermark, not a
   per-message flag, so one event self-heals past any earlier missed one); `presence:update` (server
   → every device of every user sharing a conversation with the affected user, on their online device
   count crossing zero either way). "Online" is in-process state in `modules/relay/socket.ts`
   (`isUserOnline`), *not* the Redis TTL heartbeat `docs/RETENTION.md` §2 originally sketched — this
   single-process deployment already gets that for free from Socket.IO's own connection state, a
   divergence ADR-0011 documents explicitly. `devices.lastSeenAt` (existing column, no schema change)
   is now updated on disconnect too, not just connect. `GET`/`POST /conversations`'s `members` array
   gained `online`/`lastSeenAt` alongside Part 4's `avatarUrl`. Client state lives entirely in
   `apps/web/app/chat/[id]/page.tsx` via the raw `socket` `sync-context.tsx` already exposes for
   exactly this ("features that need to speak directly to the server over events sync-engine doesn't
   own") — none of it touches `packages/sync-engine` or `packages/local-store`, since it's ephemeral
   UI state, not part of the durable local-first model. Read tick color is `text-status-online`
   (green), deliberately not blue, per the user's explicit ask. New unit/integration tests cover the
   `deliveredToAllRecipients` logic (including the specific multi-device-sender scenario ADR-0011
   calls out) and the new `modules/presence/presence.service.ts` helpers; live-verified with
   Playwright end-to-end — watched a message's tick progress ✓ → ✓✓ (white) → ✓✓ (green) as the
   recipient opened the thread, and watched the sender's header live-update from "Online" to "Last
   seen just now" the instant the recipient's tab closed.
4. **Part 4 — DONE (2026-08-27).** Profile pictures. `users.avatarUrl` was already partially in use
   (GitHub OAuth signups get GitHub's own public CDN URL stored verbatim) — self-uploaded avatars
   needed a design decision the original one-line plan undersold, written up as
   [ADR-0010](docs/ADR/0010-profile-pictures.md): no new R2 bucket/public-access toggle (would leak
   `attachments/` message-media objects too, since R2's public-access setting is bucket-wide, not
   per-prefix — see ADR-0010's Decision), so self-uploaded avatars stay in the existing private
   bucket under `avatars/{userId}/{uuid}`, and `users.avatarUrl` now holds *either* a plain external
   URL (OAuth, used as-is) *or* a bare R2 key (self-uploaded, resolved to a fresh 24h-TTL presigned
   GET by `modules/users/avatar.service.ts`'s `resolveAvatarUrl` — long-lived unlike message media's
   300s, since an avatar is resolved once per API response and then displayed un-refreshed for a
   whole session). New endpoint `POST /me/avatar/upload-url` (mirrors `/media/upload-url`, 5MB cap);
   `PATCH /me` gained an optional `avatarUrl` (an r2Key or `null` to remove — never a client-supplied
   URL, closing off a way to bypass the upload flow). `toPublicUser` and the conversations
   members-list resolver now both resolve avatars before sending a response. Replacing an avatar
   best-effort deletes the old R2 object (unlike ADR-0009's accepted orphan risk for message media —
   a user changing their photo repeatedly is common, not a rare race, so it's worth the extra delete
   call). Client: a shared `Avatar` component (real photo or an initial-letter fallback circle, never
   a broken-image icon) now appears in Settings > Edit profile (upload/remove), Inbox rows, Thread
   headers, conversation settings' member list, and New Chat's participant list. Live-verified with
   Playwright: uploaded a real photo on one account, confirmed it renders immediately in that
   account's own Settings page, and confirmed a second account's Inbox row and Thread header both
   show that photo (the "other member's avatar" case, `conversationAvatarUrl`) — not just the
   fallback initials it showed before the upload.
5. **Part 6 — DONE (2026-08-27).** UI polish pass, last on purpose (styled the new tick/avatar/
   last-seen surface once, rather than redoing it). Direction drafted as a design canvas first
   (Signal restraint + Telegram's denser, more colorful chrome, per the user's brief) and approved
   before any code changed — see `docs/UI_DIRECTION.md`'s "Phase 6 part 6 revision" section for the
   full writeup. Two changes: `accent.primary` deepened (same hue, more chroma — every existing
   `bg-accent-primary` usage picked this up for free via the CSS custom property, no component
   touched for this half), and a six-color avatar palette replacing the single flat accent circle
   every fallback initial-letter avatar used to be (`apps/web/components/avatar.tsx`, hashed per
   contact). Also added: a small online-dot on avatars and an Inbox-row timestamp — both flagged as
   layout additions alongside the color work when the direction was proposed, not silently bundled.

   Two real bugs found building this, both in `apps/web/tailwind.config.ts`/`avatar.tsx`, neither
   caught until live verification: the Tailwind `content` glob only ever scanned `./app/**`, so the
   new `bg-avatar-*` classes (only ever written in `components/`) were never generated at all —
   every fallback avatar silently rendered with no background color. Separately, the palette lookup
   itself first built a class name from a template string, which Tailwind's static scanner can never
   see regardless of the content glob. Both fixed; confirmed live with two real accounts rendering
   two visibly different avatar colors, the deepened accent throughout, and the new timestamp/dot.

**Follow-up from the user's own end-to-end pass, 2026-08-28: recipients had no way to save a
received image attachment.** Not a regression from any of the six items above — this gap existed
since media attachments first shipped (Phase 6 part 2b); it just hadn't been noticed until someone
tried to actually save one. `AttachmentImage` (`apps/web/app/chat/[id]/page.tsx`) only ever rendered
the object URL inline via `<img>`, with no download affordance at all. Fixed by adding a small
"Download" link right under the image, `<a href={url} download="attachment.{ext}">`, reusing the
same blob object URL the `<img>` already holds — no new fetch, no new local-store read. Applies to
every bubble that can show an image (sender's own, incoming, and the optimistic outbox bubble) since
they all go through the same `AttachmentImage` component. Live-verified with Playwright: a real file
saved by the receiver is byte-identical to the original upload.

Re-verified in a follow-up session (2026-08-28) against a freshly-started `pnpm dev` (never reuse a
long-running one — this project has hit stale-bundle false alarms from that twice before): a real
two-account Playwright run (register both, direct chat, upload a real PNG, receiver clicks
"Download") confirmed the saved file's SHA-256 matches the original upload exactly. **Phase 6, all
parts, is now fully done and fully verified.**

**Phase 7 (Deployment & live demo): complete.** `apps/server` on Render (free Web Service,
`https://driftline-schd.onrender.com`), `apps/web` on Vercel
(`https://driftline-web-gamma.vercel.app`, linked from the README). Both auto-deploy from
`origin/main`. Per a decision made with the user before provisioning anything: the GitHub OAuth App
is shared between local dev and production (a second authorized callback URL added, not a second
app), and Neon/Upstash/Resend/R2 are all the same free-tier instances local dev already used — no
new infra provisioned, matching this project's $0-budget/single-environment posture. The R2 bucket's
CORS policy gained the Vercel origin alongside `localhost:3000` (both `PUT` and `GET`, same lesson
as ADR-0009's original CORS miss).

Two real bugs found and fixed during deployment, neither hypothetical:

1. Render's `WEB_ORIGIN` env var was entered with a trailing slash
   (`https://driftline-web-gamma.vercel.app/`). `@fastify/cors` treats a string `origin` option as a
   literal value to echo back, not a pattern to match against the request's `Origin` header — so it
   returned `204` with that header set regardless of what `Origin` the caller sent, making `curl`
   checks look fine. A real browser's `Origin` header never has a trailing slash, so the exact-string
   comparison the browser itself performs against `Access-Control-Allow-Origin` always failed,
   silently blocking every real cross-origin request. Caught by explicitly comparing the response
   header byte-for-byte against the expected origin, not just checking for a `204`/200. Fixed by
   correcting the env var (took two attempts — the first edit didn't trigger a redeploy on Render
   until a manual deploy was triggered).
2. The bigger one: live verification against the deployed URLs kept failing in ways that didn't
   match any app bug — until inspecting the actual served HTML for the `AttachmentImage` component
   showed the *pre-fix* markup (no wrapping `<div>`, no `<a>Download</a>` at all). `git status`
   revealed why: local `main` was 4 commits ahead of `origin/main` — including the download-link fix
   (`9a2e285`) and all of Phase 6 parts 3–6 (presence/receipts, avatars, the UI polish pass) — none
   of it had ever been pushed. Render and Vercel both deploy from `origin/main`, so both were quietly
   serving a build from before Phase 6 part 5 the entire time this session started. Fixed by pushing;
   both platforms auto-redeployed within about a minute.

Live-verified end-to-end against the real deployed URLs post-fix, not just build success: a
Playwright run registered two real accounts directly against `driftline-web-gamma.vercel.app`,
started a direct chat, sent a text message over the real production Socket.IO relay, uploaded a real
PNG through the live R2 bucket, and confirmed the recipient's "Download" link produces a
byte-for-byte SHA-256 match of the original file — the same bar every prior phase was held to,
now cleared against production infra instead of local dev.

**Phase 8 (Hardening, observability & retention compliance): parts A and C done; part B (Sentry) on
hold pending a Sentry account from the user.** Scoped into three parts up front rather than the
single generic "hardening" line `docs/ROADMAP.md`'s table row implies, since research into what
actually exists turned up concrete, non-hypothetical gaps rather than a vague to-do:

- **Part A — crash-safety hardening, done.** Two live crash risks, neither ever triggered in
  practice but both real given this app's actual infra: `packages/db/src/client.ts`'s `pg.Pool` and
  `apps/server/src/lib/redis.ts`'s `ioredis` client both had zero `.on("error", ...)` listeners —
  Neon's free-tier auto-suspend and Upstash's idle timeouts both drop connections routinely, and an
  unhandled `error` event on either client crashes the whole Node process by default. Both now log a
  structured metric line and let the underlying client's own reconnect logic handle it. Also added:
  `process.on("uncaughtException"/"unhandledRejection")` guards (log via the same path as the
  existing error handler, then exit so the platform's restart-on-crash still applies, but the
  failure is actually visible in the logs first) and a real `/health` endpoint
  (`apps/server/src/lib/health.ts`) that pings Postgres and Redis with a 2-second timeout each and
  returns `503` if either is unreachable, instead of the previous unconditional `{status:"ok"}` —
  Render's own health check couldn't previously tell "up but broken" from healthy. Closed four
  rate-limiting gaps found during the audit (`/auth/refresh`, `/auth/magic-link/verify`,
  `DELETE /devices/:id`, `POST /conversations` all had no limit at all, unlike every other
  auth-adjacent or write endpoint). Full writeup in the new `docs/SECURITY.md`. Full pipeline
  (lint/typecheck/test/build, 59 tests including four new ones for the health-check logic) green for
  `@driftline/server` and `@driftline/db` against a real local Postgres.
- **Part C — retention compliance closeout, done.** `docs/RETENTION.md` §8's open question (device
  *record* cleanup after long dormancy) was carried since Phase 0 and explicitly gated on the device
  manager UI existing — Phase 5 shipped that UI. Closed as: device records are retained indefinitely;
  only revocation (not row deletion) is exposed, since a `Device` row is routing metadata, not
  content, and revocation already does everything the retention contract actually needs. Formalized
  as a new point 5 in [ADR-0002](docs/ADR/0002-retention-storage-model.md). Also wrote the two
  remaining "lands in later phases" docs from this file's own repo-layout note: `docs/SECURITY.md`
  and `docs/RUNBOOK.md` (the latter grounded in this project's own real incidents — the Phase 7 CORS
  trailing-slash bug, the unpushed-commits deploy-staleness bug, the recurring stale-`pnpm-dev`
  false alarm, and the Turborepo strict-env-mode gap — not generic runbook boilerplate).
- **Part B — Sentry wiring, done.** The user provided a Sentry DSN (free tier). `@sentry/node`
  installed in `apps/server` only; `SENTRY_DSN` is optional in `env.ts` (local dev runs fine without
  it) and tags every event with `NODE_ENV`, so one DSN safely covers both dev and prod — filterable
  by environment in Sentry's dashboard rather than needing two projects. `apps/server/src/lib/
  sentry.ts` is the actual "PII scrubbing configured from day one" ADR-0001 committed to:
  `sendDefaultPii: false` (no IP/cookie/body auto-attached) plus a `beforeSend` that strips
  `authorization`/`cookie` headers from whatever request context does get attached. Wired into all
  three places an error can surface: the global error handler's 5xx branch, and both
  `uncaughtException`/`unhandledRejection` guards (which now call `Sentry.flush` before
  `process.exit`, so a crash's own event isn't dropped mid-flight by the exit itself). This also
  closes `docs/RETENTION.md` §7's last unchecked checklist item: a new
  `modules/relay/retention-monitor.ts` checks the oldest still-present envelope's age against
  `createdAt` every sweep cycle (independent of `expiresAt`, so a bug in that computation can't mask
  itself) and reports a violation to Sentry at `fatal` level plus a `retention_violation_total`
  structured log line — Sentry's dashboard is the alerting surface, deliberately not a new
  Prometheus/Grafana stack for one free-tier instance. Verified two ways: a standalone script
  (written, run, then deleted — not left in the repo) called `captureException` + `Sentry.flush`
  against the real DSN and confirmed a successful flush; and `retention-monitor.test.ts`
  (2 new tests, 61 total now) proves the violation-detection logic itself by forcibly back-dating a
  real envelope's `createdAt` by 31 days against a real Postgres. Full pipeline
  (lint/typecheck/test/build) green for `@driftline/server` and `@driftline/db`.

**Phase 8 is now fully done** (all three parts, A/B/C).

**Phase 9 (GitHub integration & CI/CD): done.** Scoped per `docs/ROADMAP.md`'s Phase 9 line, with
one thing checked before implementing rather than assumed: whether "required status checks on
direct pushes to `main`, without requiring a PR" (the middle ground between this project's no-PR
working agreement and classic branch-protection-forces-PRs) was actually available. It wasn't —
`gh api repos/.../branches/main/protection` and the rulesets endpoint both returned `403: "Upgrade
to GitHub Pro or make this repository public"` — GitHub's protected-branches feature (rulesets
included) is Pro-only for **private** repos, free only once a repo is public. That made this a
real three-way decision (skip branch protection / go public / pay for Pro), not a style preference,
so it went back to the user rather than being decided unilaterally. Resolved: **the repo is now
public** (`dsouzamelroy2007/driftline`) — the user's own call, made independently before this
phase's implementation started. Branch protection/rulesets themselves were **not** enabled even
though they're now free to enable — the no-PR working agreement from Phase 1 stands; going public
only removed the paywall, it didn't change the decision about whether to gate `main` behind
required checks, and that wasn't re-opened.

Landed:
- **`.github/workflows/retention.yml`** — the concrete deliverable `docs/ROADMAP.md`'s Phase 9 row
  names. A dedicated check, separate from `ci.yml`, that builds only `@driftline/db` (the one
  dependency `apps/server`'s tests actually need compiled — vitest transpiles `apps/server`'s own
  TS directly) against the same `postgres:16` service-container pattern `ci.yml` already uses, then
  runs `vitest run retention` — a filename-pattern filter, verified locally to resolve to exactly
  `retention.integration.test.ts` (the Phase 3 exit gate: ack/expiry/revocation purge paths) and
  `retention-monitor.test.ts` (the Phase 8 compliance check), nothing else. The point: a break in
  the retention contract itself now shows up as its own named, unmissable status check instead of
  being buried among every other server test in one combined `ci.yml` run. Verified the file-match
  is correct (collected exactly those two files, both failing only on missing `DATABASE_URL` with
  no Postgres available locally in this session) — not live-run against a real Postgres end-to-end,
  since that would mean either standing up local Docker (unavailable in this session) or pointing
  at the real dev Neon DB, which the existing README explicitly steers away from for this exact
  suite (it seeds real rows and would pollute shared dev data). The workflow mirrors `ci.yml`'s
  already-proven Postgres service-container config exactly, so this is considered adequately
  verified pending its first real run on `main`.
- **`.github/dependabot.yml`** — weekly updates for the pnpm workspace (root `npm` ecosystem, one
  entry covers every package) and GitHub Actions versions, with minor/patch npm bumps grouped into
  one weekly PR so routine dependency churn doesn't spam a dozen individual PRs; a major bump still
  gets its own. This is the one deliberate, acknowledged exception to the no-PR agreement — the
  user opted in explicitly, on the reasoning that automated dependency PRs (optional to merge,
  dismissable, not human review overhead) are a different kind of thing than the review-overhead
  problem the no-PR agreement was set up to avoid.
- **CI/Retention badges** added to `README.md`, plus a short note on what `retention.yml` covers
  and why it's separate from `ci.yml`.
- **Repo made public**, with a description and topic tags set
  (`chat-app`/`real-time`/`local-first`/`socket-io`/`nextjs`/`fastify`/`typescript`/`postgresql`/
  `drizzle-orm`/`webrtc`/`turborepo`/`monorepo`) — previously blank on both.

Not built, deliberately: branch protection / rulesets themselves (see above — available now that
the repo is public, but the no-PR working agreement wasn't reopened, so nothing gates `main` beyond
CI reporting pass/fail); CODEOWNERS and PR/issue templates (no real audience for them on a solo
repo without a PR-based workflow); CodeQL/code scanning (free for public repos, but a genuinely new
scope decision — not implied by "GitHub integration & CI/CD" the way the retention job and
Dependabot were — left for a deliberate follow-up if wanted rather than bundled in here).
