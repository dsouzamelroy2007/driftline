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
docs/ADR/                           — 0001 stack, 0002 retention/storage, 0003 multi-device sync,
                                       0004 auth token model, 0005 Postgres driver,
                                       0006 local-store engine
```
(`apps/`, `packages/` now exist as of Phase 1 — see below. `infra/` and the remaining `docs/*.md`
listed in the master plan's repo layout — `ARCHITECTURE.md`, `SYNC_MODEL.md`, `SCALE.md`,
`SECURITY.md`, `RUNBOOK.md`, `CASE_STUDY.md`, `BACKUP_FORMAT.md` — land in later phases.)

## Repo layout (as of Phase 6, part 1)

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
                        Phase 6 added importTimelineEntries (bulk-writes historical data from a
                        backup or a device-linking transfer, bypassing the live-sync seq-sequential
                        classifyAndAdvanceCursor path entirely — see docs/RETENTION.md's bulk-import
                        note) and listAllTimelineEntries (full unpaginated history, for export).
packages/sync-engine/   Drives local-store from docs/REALTIME_PROTOCOL.md. createSyncEngine({socket,
                        store, selfUserId, selfDeviceId}) — depends on socket.io-client directly
                        (no custom transport abstraction). All inbound socket events + outbox
                        flushes funnel through one serialized EventQueue so dormancy:return's
                        fan-out can't race a concurrently-arriving envelope:deliver.
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
`PATCH /me` (update `displayName`), `GET /users/lookup?email=` (exact-match lookup, powers Phase 5's
New Chat), `GET /me/storage` (`{envelopeCount, oldestExpiresAt}` — the "you currently have N
messages held on our servers" widget, counts distinct envelopes via `envelope_targets` joined to
`envelopes`, never touches payload), `GET /devices`, `DELETE /devices/:id` (revoke — now also
synchronously purges the device's pending envelope targets, see below), `POST /devices/link/start`
(authed, rate-limited — mints an 8-digit device-linking pairing code, Redis-only state, 120s TTL;
see Relay note below), `GET /discovery`
(service-discovery contract, Redis heartbeat registry), `POST /auth/magic-link/request`,
`POST /auth/magic-link/verify` (Redis-backed, single-use via `GETDEL`), `GET
/auth/oauth/github/start`, `GET /auth/oauth/github/callback` (redirects to
`${WEB_ORIGIN}/auth/callback#accessToken=...&refreshToken=...`, handled by
`apps/web/app/auth/callback/page.tsx` since Phase 5). Rate-limited (`/auth/register`, `/auth/login`,
`/auth/magic-link/request`, 20/min, Redis-backed). Not built: Google OAuth (same pattern as
GitHub's `oauth/github.service.ts`, deferred).

Relay (Phase 3, `apps/server/src/modules/relay/`, full contract in `docs/REALTIME_PROTOCOL.md`):
`POST /conversations`, `GET /conversations` (direct + group, ≤100 members; each conversation now
also carries a `members: {userId, displayName}[]` array, added in Phase 5 since the web client has
no other way to render a conversation's name — `conversations` itself still has no `name` column,
so a group's display name is derived client-side by joining member names;
`apps/web/lib/conversation-name.ts`). Socket.IO: handshake auth via the same access-token
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
`infra/scripts/sweeper` — revisit only if this needs to move out-of-process (Phase 8/9). Not built:
presence, typing indicators, read receipts — `docs/RETENTION.md` §2 already reserves Redis TTL rows
for presence/typing, but no relay event for either was ever implemented (checked directly against
`modules/relay/socket.ts` during Phase 5); the web UI only shows sent/delivered, derived from ack.
Also not built: attachments/R2 and client-side search (both deferred to a Phase 6 follow-up pass —
this pass covered backup export/import and device linking only, see Status below).

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

Next: Phase 6, part 2 (media/attachments via R2, client-side FTS5 search) — the remainder of the
original Phase 6 scope, deferred by explicit agreement before this pass started since it needs a new
Cloudflare R2 account (user credentials) and is a large enough scope on its own. Also still open: the
presence/typing/read-receipt gap and the deferred custom-group-name schema change noted in Phase 5,
revisit if either becomes worth prioritizing.
