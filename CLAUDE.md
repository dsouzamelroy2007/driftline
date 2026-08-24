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

## Where things live

```
design/reference-system-design.md   — the source system-design study (read-only reference)
docs/DESIGN_REVIEW.md               — what transfers/breaks/is-overkill from the reference doc
docs/RETENTION.md                   — the retention model contract (read before touching purge logic)
docs/REALTIME_PROTOCOL.md           — Socket.IO contract: handshake auth, every event, gap-notice signaling
docs/UI_DIRECTION.md                — IA, screens, nav, tokens, motion, retention-specific UX
docs/ROADMAP.md                     — phase sequence, MVP cut, open questions
docs/ADR/                           — 0001 stack, 0002 retention/storage, 0003 multi-device sync,
                                       0004 auth token model, 0005 Postgres driver
```
(`apps/`, `packages/` now exist as of Phase 1 — see below. `infra/` and the remaining `docs/*.md`
listed in the master plan's repo layout — `ARCHITECTURE.md`, `SYNC_MODEL.md`, `SCALE.md`,
`SECURITY.md`, `RUNBOOK.md`, `CASE_STUDY.md`, `BACKUP_FORMAT.md` — land in later phases.)

## Repo layout (as of Phase 3)

```
apps/server/           Fastify + Socket.IO. Auth/device/discovery/conversations REST API, plus the
                        Socket.IO relay: handshake auth, per-device rooms, message send/deliver/ack,
                        ack-triggered purge, expiry sweeper + dormancy sweep (in-process intervals).
apps/web/               Next.js App Router — single shell page, no real UI yet (Phase 5)
packages/db/            Drizzle schema (users, devices, oauth_accounts, conversations,
                        conversation_members, conversation_sequences, envelopes, envelope_targets)
                        + node-postgres client (ADR-0005) + migrations
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
`JWT_SECRET`, plus `RETENTION_WINDOW_DAYS`/`DEVICE_DORMANCY_DAYS` (both default 30). Run
`pnpm --filter @driftline/db db:migrate` once after schema changes.

Auth API (all under `apps/server`, see ADR-0004 for the token model):
`POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`,
`GET /devices`, `DELETE /devices/:id` (revoke — now also synchronously purges the device's pending
envelope targets, see below), `GET /discovery` (service-discovery contract, Redis heartbeat
registry), `POST /auth/magic-link/request`, `POST /auth/magic-link/verify` (Redis-backed,
single-use via `GETDEL`), `GET /auth/oauth/github/start`, `GET /auth/oauth/github/callback`
(redirects to `${WEB_ORIGIN}/auth/callback#accessToken=...&refreshToken=...` — that page doesn't
exist yet, Phase 5). Rate-limited (`/auth/register`, `/auth/login`, `/auth/magic-link/request`,
20/min, Redis-backed). Not built: Google OAuth (same pattern as GitHub's `oauth/github.service.ts`,
deferred).

Relay (Phase 3, `apps/server/src/modules/relay/`, full contract in `docs/REALTIME_PROTOCOL.md`):
`POST /conversations`, `GET /conversations` (direct + group, ≤100 members). Socket.IO: handshake
auth via the same access-token verification path as HTTP; `message:send` (ack-callback with
`{envelopeId, seq}`), `envelope:deliver` (server → client), `envelope:ack` (client → server, the
hot path that triggers the transactional purge), `dormancy:return` (gap-notice signal on
reconnect). Purge paths: ack-triggered (same transaction, `SELECT ... FOR UPDATE` serializes
concurrent acks on one envelope — see `modules/relay/purge.ts`), expiry sweeper, and device
revocation, all logging `envelope_purged_total{reason}` with envelope ID + size only. Expiry
sweeper and dormancy sweep run as in-process `setInterval`s (every 5 min), not a separate
`infra/scripts/sweeper` — revisit only if this needs to move out-of-process (Phase 8/9). Not built:
client-side gap-notice rendering (Phase 4), attachments/R2 (MVP+).

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

Next: Phase 4 (Client sync engine & local-first store) — `packages/local-store`/`packages/sync-engine`
consuming `docs/REALTIME_PROTOCOL.md`, including client-side gap-notice rendering
(`docs/RETENTION.md` §6) from the sequence numbers and `dormancy:return` signal the relay now emits.
