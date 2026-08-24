# ADR-0001: Technology Stack

**Status:** Accepted — 2026-08-24

## Context

Driftline must run entirely on free-tier infrastructure, support a shared-logic web + mobile client
architecture, and terminate WebSocket connections somewhere that can hold them for the lifetime of a
session (ruling out pure serverless for the realtime path). It also needs to be legible to an
engineer reading the repo as a portfolio piece — boring, well-documented technology choices read
better than clever ones.

## Decision

| Layer | Choice | Why this and not the obvious alternative |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | Free, fast, standard for shared TS packages across web/mobile/server. npm/yarn workspaces work too but Turborepo's task caching matters once `packages/*` grows. |
| Web client | Next.js (App Router) + TypeScript, on **Vercel** | Vercel's free tier is generous for a portfolio-traffic site; App Router gives route handlers for the non-realtime BFF surface without a separate API app. |
| Chat server | Node + Fastify + Socket.IO, on **Render** | Vercel functions cannot hold a WebSocket open — this is the reason a second host exists at all. Fastify over Express for schema-validated routes and better throughput at negligible complexity cost. Socket.IO over raw `ws` for its reconnection/room primitives and its Redis adapter, which we need anyway for multi-instance fan-out headroom. |
| Durable store | **Neon** Postgres + Drizzle | Neon's serverless Postgres free tier fits our actual durable dataset (identity/routing metadata, not message history — see ADR-0002). Drizzle over Prisma: lighter runtime, SQL-shaped queries that stay legible in a portfolio repo, and first-class support for Neon's HTTP/pooled driver without a heavy client. Prisma's DX wins don't offset that for a codebase meant to be *read*. |
| Cache / pub-sub | **Redis** (Upstash free tier) | Socket.IO adapter, presence TTLs, service-discovery registry, rate limiting. One free-tier Redis instance covers all four; no need for separate systems. |
| Client store (web) | SQLite-WASM on OPFS, or Dexie/IndexedDB — decided in ADR accompanying Phase 4 | Deferred to a dedicated storage ADR once `packages/local-store`'s query needs (esp. FTS) are concrete; noted here so the choice isn't lost. |
| Client store (mobile) | `expo-sqlite` + Drizzle, FTS5 | Matches the server's ORM for shared query-building patterns; SQLite FTS5 gives real full-text search on-device for free. |
| Object storage | Cloudflare R2 | Free egress (unlike S3), free tier large enough for a portfolio demo, native lifecycle rules for the 30-day attachment TTL. |
| Email | Resend | Free tier, good deliverability, simple API for magic links/OTP. |
| Mobile | Expo + EAS Build/Submit | Managed workflow keeps one codebase targeting Android + iOS without maintaining native project files by hand; EAS free build minutes are sufficient for portfolio-cadence releases. |
| Push | Expo Push + Web Push (VAPID) | Expo Push covers both mobile platforms through one API; Web Push covers the PWA. Neither requires a paid push gateway. |
| Errors | Sentry | Free tier sufficient at this traffic; PII scrubbing configured from day one (Phase 8), not bolted on later. |
| Cron | GitHub Actions schedule (primary), cron-job.org (fallback for anything GH Actions can't reach) | No paid cron product needed; sweeper and demo-reset are simple scheduled HTTP calls. |
| CI/CD | GitHub Actions + Vercel/Render auto-deploy | Standard, free for a public repo, and the deploy story becomes "push to main" with no custom pipeline to maintain. |

## Consequences

- **Hard rule enforced by this ADR:** WebSockets terminate on Render only. Next.js is UI + BFF route
  handlers, nothing that must survive a Render cold start lives in process memory anywhere — it lives
  in Neon or Redis. This constrains every later phase's design; a future "let's just keep it in
  memory" shortcut is a violation of this ADR, not a valid optimization.
- Two free-tier failure modes are now permanent design inputs, not edge cases to patch in later:
  Render's free service sleeps after inactivity (cold-start UX, Phase 7), and Neon's compute
  auto-suspends (connection pooling and retry-on-cold-connect become required, not optional).
- Drizzle over Prisma means slightly more manual SQL-shaped code and slightly less migration tooling
  polish; accepted because the schema is small (Envelope/EnvelopeTarget/User/Device/Conversation and
  a handful more) and the trade favors legibility for portfolio readers.
- Socket.IO's protocol overhead (vs. raw WebSocket) is accepted for its reconnection semantics and
  Redis adapter, both of which the reliability model (`docs/SYNC_MODEL.md`, Phase 3) depends on
  directly.

## Alternatives considered and rejected

- **Supabase Realtime / Firebase** instead of a custom Socket.IO server: would remove the entire
  relay-and-purge design that is the point of this project. Rejected on scope grounds, not
  technical merit.
- **PlanetScale/other MySQL-compatible serverless DB** instead of Neon: comparable free tier, but
  Neon's branch-per-PR workflow (used in CI, Phase 9) is a better fit for the "Neon branch per PR"
  requirement already scoped into the project.
- **Raw `ws` library** instead of Socket.IO: less overhead, but reimplements reconnection and
  room/broadcast primitives Socket.IO gives for free — not worth it at this scope.
