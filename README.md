# Driftline

[![CI](https://github.com/dsouzamelroy2007/driftline/actions/workflows/ci.yml/badge.svg)](https://github.com/dsouzamelroy2007/driftline/actions/workflows/ci.yml)
[![Retention](https://github.com/dsouzamelroy2007/driftline/actions/workflows/retention.yml/badge.svg)](https://github.com/dsouzamelroy2007/driftline/actions/workflows/retention.yml)

> Your messages live on your device, not ours.

A local-first, real-time chat app. The server is a transport, not an archive: it never retains a
message body once every recipient device has confirmed receipt, and holds anything undelivered for
at most 30 days before it's gone for good. Chat history, search, and unread state all live on your
device — the server keeps only who you are, who you talk to, and what's currently in flight.

This repo is a work in progress, built phase by phase as a portfolio project. Status and the current
phase are tracked in [`CLAUDE.md`](CLAUDE.md).

**Live demo:** [driftline-web-gamma.vercel.app](https://driftline-web-gamma.vercel.app) (web on
Vercel, relay on Render's free tier — the first request after a period of inactivity may take a
few seconds to wake the server up).

## Docs

- [`docs/DESIGN_REVIEW.md`](docs/DESIGN_REVIEW.md) — what we kept, changed, and dropped from the
  reference chat-system architecture, and why.
- [`docs/RETENTION.md`](docs/RETENTION.md) — the formal retention model: what's stored, for how
  long, and the exact purge rules.
- [`docs/REALTIME_PROTOCOL.md`](docs/REALTIME_PROTOCOL.md) — the Socket.IO contract: handshake
  auth, every event, and what a client must not assume about history/replay.
- [`docs/UI_DIRECTION.md`](docs/UI_DIRECTION.md) — information architecture, screens, and the UX
  problems this architecture creates that a normal chat app doesn't have.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — phase sequence and MVP scope.
- [`docs/SECURITY.md`](docs/SECURITY.md) — auth, rate limiting, CORS, and crash-safety posture.
- [`docs/RUNBOOK.md`](docs/RUNBOOK.md) — operational reference, written from real incidents.
- [`docs/ADR/`](docs/ADR/) — architecture decision records, including every deliberate divergence
  from the reference design.
- [`design/reference-system-design.md`](design/reference-system-design.md) — the source system-design
  study this project starts from and departs from.

A full setup guide, architecture diagram, and case study land as the corresponding phases complete
(see the roadmap).

## Getting started

Requires Node (see `.nvmrc`) and pnpm (via corepack — `corepack enable`).

```sh
pnpm install
cp .env.example .env   # fill in DATABASE_URL (Neon), REDIS_URL (Upstash), JWT_SECRET,
                        # RESEND_API_KEY, GITHUB_CLIENT_ID/SECRET — see .env.example for where each comes from
pnpm --filter @driftline/db db:migrate   # apply the Postgres schema
pnpm dev          # runs apps/server and apps/web in parallel
pnpm build        # build everything
pnpm lint          # lint everything
pnpm typecheck     # typecheck everything
pnpm test          # test everything
```

To run the relay's integration tests (`apps/server/src/modules/relay/retention.integration.test.ts`
— the Phase 3 exit gate proving zero message bodies survive after all parties ack) against a local
Postgres instead of your real Neon dev DB:

```sh
docker compose up -d   # postgres:16 on localhost:5433, db driftline_test
DATABASE_URL=postgres://driftline:driftline@localhost:5433/driftline_test \
  pnpm --filter @driftline/db db:migrate
DATABASE_URL=postgres://driftline:driftline@localhost:5433/driftline_test \
  pnpm --filter @driftline/server test
```

CI does the same against a GitHub Actions Postgres service container — see `.github/workflows/ci.yml`.
The retention purge paths (ack-triggered, expiry sweep, revocation) additionally get their own
dedicated check, `.github/workflows/retention.yml`, so a break in that specific guarantee shows up
as its own named status rather than being buried in the general test run.

`apps/server` listens on `:4000` — `/health`, an auth API (password, magic-link, GitHub OAuth),
device registry, `/discovery`, conversations, and the Socket.IO relay (handshake auth, message
send/deliver/ack — see [`docs/REALTIME_PROTOCOL.md`](docs/REALTIME_PROTOCOL.md)). `apps/web` runs
the Next.js dev server on `:3000`.

`packages/local-store` and `packages/sync-engine` are headless — no UI yet (Phase 5), but fully
tested by `pnpm test`, no external services required (they run against Node's built-in `node:sqlite`,
not the production browser backend). The production backend is SQLite Wasm over OPFS
(`packages/local-store`'s `"./browser"` export, via `sqlocal`) — see
[`docs/ADR/0006-local-store-engine.md`](docs/ADR/0006-local-store-engine.md) for why, and why it
needs the `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy` headers already set in
`apps/web/next.config.ts`.
