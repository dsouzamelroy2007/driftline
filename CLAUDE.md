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

## Where things live

```
design/reference-system-design.md   — the source system-design study (read-only reference)
docs/DESIGN_REVIEW.md               — what transfers/breaks/is-overkill from the reference doc
docs/RETENTION.md                   — the retention model contract (read before touching purge logic)
docs/UI_DIRECTION.md                — IA, screens, nav, tokens, motion, retention-specific UX
docs/ROADMAP.md                     — phase sequence, MVP cut, open questions
docs/ADR/                           — 0001 stack, 0002 retention/storage, 0003 multi-device sync,
                                       0004 auth token model
```
(`apps/`, `packages/` now exist as of Phase 1 — see below. `infra/` and the remaining `docs/*.md`
listed in the master plan's repo layout — `ARCHITECTURE.md`, `REALTIME_PROTOCOL.md`, `SYNC_MODEL.md`,
`SCALE.md`, `SECURITY.md`, `RUNBOOK.md`, `CASE_STUDY.md`, `BACKUP_FORMAT.md` — land in later phases.)

## Repo layout (as of Phase 2 core)

```
apps/server/           Fastify + Socket.IO. Real auth/device/discovery API now (see below);
                        Socket.IO itself is still just the Phase 1 ping/pong — handshake auth,
                        rooms, and message relay are Phase 3.
apps/web/               Next.js App Router — single shell page, no real UI yet (Phase 5)
packages/db/            Drizzle schema (users, devices) + Neon client + migrations
packages/ui-tokens/     Design tokens (docs/UI_DIRECTION.md §5) + Tailwind preset
packages/tsconfig/      Shared strict base tsconfig
packages/eslint-config/ Shared flat ESLint config + Prettier config
```
Root scripts (`pnpm dev|build|lint|typecheck|test`) all delegate to Turborepo. CI
(`.github/workflows/ci.yml`) runs the same four tasks on every push to `main`.

`apps/server` env vars: see `.env.example` at repo root — copy to `.env` (gitignored) with real
Neon (`DATABASE_URL`) and Upstash (`REDIS_URL`, must be the `rediss://` protocol string, not the
REST URL) values, plus a generated `JWT_SECRET`. Run `pnpm --filter @driftline/db db:migrate` once
after schema changes.

Auth API (all under `apps/server`, see ADR-0004 for the token model):
`POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`,
`GET /devices`, `DELETE /devices/:id` (revoke), `GET /discovery` (service-discovery contract, Redis
heartbeat registry). Rate-limited (`/auth/register`, `/auth/login`, 20/min, Redis-backed).
Not built yet: magic-link login, OAuth (Google/GitHub) — deferred follow-on to Phase 2, needs Resend
+ OAuth app credentials. Also not built: Socket.IO handshake auth, `Conversation`/`Envelope`/etc.
schema (Phase 3), device dormancy *sweeping* (field exists, the scheduled job is Phase 3).

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

**Phase 2 core (Identity, devices & service discovery): complete on `main`.** `packages/db`
(Neon+Drizzle schema for `users`/`devices`) and the auth/device/discovery API in `apps/server` are
built and verified end-to-end against real Neon + Upstash (register → login with device reuse →
`/me` → `/devices` → refresh rotation with old-token rejection → device revocation with immediate
access-token rejection → `/discovery` → rate-limit 429). Two real bugs found and fixed during
verification: auth responses were leaking `passwordHash`/`refreshTokenHash` (fixed via
`lib/serialize.ts`), and the global error handler was masking `@fastify/rate-limit`'s 429s as 500s
(fixed by respecting any thrown error's own `statusCode`, not just the app's `HttpError` class). Full
pipeline (lint/typecheck/test/build, 8 new unit tests) green.

Follow-on to Phase 2 (deferred, not started): magic-link login (needs Resend) and OAuth/Google+GitHub
(needs those app credentials) — see "Repo layout" above.

Next: either the Phase 2 follow-on (magic-link/OAuth) or moving straight to Phase 3 (Relay core:
store-and-forward, fan-out & retention) — ask the user which.
