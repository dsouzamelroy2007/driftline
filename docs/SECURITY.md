# Security Posture

**Scope:** this doc covers request-level and transport-level security (auth, rate limiting, CORS,
crash-safety, logging hygiene). It is not the retention/privacy contract — that's
[`RETENTION.md`](RETENTION.md), which governs what content is stored and for how long. The two are
related (a device that can't be revoked immediately would be both a retention *and* a security
problem) but this doc assumes RETENTION.md's guarantees already hold and focuses on everything else.

## 1. Authentication

Bearer tokens scoped to `(userId, deviceId)`, not cookies — full rationale in
[ADR-0004](ADR/0004-auth-token-model.md). Concretely, as implemented:

- Passwords hashed with bcrypt, cost factor 12 (`apps/server/src/lib/password.ts`).
- Access tokens: HS256 JWT, 15-minute TTL (`JWT_ACCESS_TTL_SECONDS`), signed with `JWT_SECRET`
  (env-provided, minimum 32 characters, enforced by `apps/server/src/env.ts`'s zod schema).
- Refresh tokens: opaque 32-byte random values, never JWTs. Only their SHA-256 hash is stored, on
  the device row. Using one rotates it immediately — a stolen-and-replayed old refresh token fails.
- Device revocation (`DELETE /devices/:id`) is checked on every authenticated request, not just at
  token issuance, so it takes effect within the request, not after a 15-minute access-token tail.
- Magic-link tokens are single-use via Redis `GETDEL` (`modules/auth/magic-link.service.ts`) — a
  token can be redeemed exactly once, and there's no window where two concurrent requests could both
  succeed with the same token.
- GitHub OAuth uses the standard authorization-code flow with a signed `state` parameter validated
  on callback (`modules/auth/oauth/oauth.routes.ts`).

## 2. Rate limiting

Redis-backed (`@fastify/rate-limit`, `apps/server/src/index.ts`), registered `global: false` — a
route is limited only if it explicitly opts in via `config: { rateLimit: ... }`. Current coverage
(Phase 8 closed the gaps marked *added*):

| Route | Limit | Why |
|---|---|---|
| `POST /auth/register` | 20/min | credential-creation abuse |
| `POST /auth/login` | 20/min | credential-guessing |
| `POST /auth/refresh` | 20/min *(added Phase 8)* | refresh-token replay/guessing |
| `POST /auth/magic-link/request` | 20/min | email-bombing |
| `POST /auth/magic-link/verify` | 20/min *(added Phase 8)* | token-guessing, even though tokens are high-entropy |
| `POST /media/upload-url` | 30/min | presigned-URL minting abuse |
| `POST /me/avatar/upload-url` | 30/min | same |
| `POST /devices/link/start` | 20/min | pairing-code minting abuse |
| `DELETE /devices/:id` | 30/min *(added Phase 8)* | authenticated write, still worth bounding |
| `POST /conversations` | 30/min *(added Phase 8)* | authenticated write, still worth bounding |

Deliberately left unlimited: read-only authenticated `GET` routes (`/me`, `/devices`, `/conversations`,
`/me/storage`, `/users/lookup`), the OAuth start/callback pair (state-validated instead), and
`/discovery` (public by design, cheap to serve, has its own heartbeat TTL in Redis). `/health` is
also unlimited — see RUNBOOK.md for why that's an accepted trade-off, not an oversight.

## 3. CORS

`@fastify/cors` and Socket.IO's own CORS option are both configured from the single `WEB_ORIGIN` env
var (`apps/server/src/index.ts`). This is a static string, not an origin-matching function — a
real, live-caught mistake during Phase 7 deployment: a trailing slash in the configured value
(`https://example.vercel.app/`) still returned `204` to a `curl` preflight (curl doesn't enforce
CORS), but silently failed every real browser request, because a browser's own `Origin` header never
has a trailing slash and the exact-string comparison the browser performs client-side failed. See
`RUNBOOK.md`'s CORS section for the concrete symptom-to-fix mapping if this recurs.

## 4. Crash-safety (Phase 8 hardening)

Three unhandled-failure paths that previously had no guard at all, all fixed in Phase 8 without
needing any new infrastructure or account:

- `packages/db/src/client.ts`'s `pg.Pool` and `apps/server/src/lib/redis.ts`'s `ioredis` client both
  now have an `.on("error", ...)` listener. Without one, a dropped idle connection — which Neon's
  free-tier auto-suspend and Upstash's own idle timeouts both do routinely — surfaces as an
  unhandled `error` event, which crashes the entire Node process by default. Both listeners now just
  log a structured `{metric: "pg_pool_error_total"|"redis_client_error_total"}` line; the
  underlying clients (`pg.Pool`, `ioredis`) already reconnect/retry on their own.
- `process.on("uncaughtException"/"unhandledRejection")` (`apps/server/src/index.ts`) — previously
  an error thrown outside a request handler (e.g. inside the sweeper's `setInterval` callback, or a
  Socket.IO event handler not wrapped by Fastify's own error handling) crashed the process with no
  structured log line at all. Now it's logged via the same `app.log.error` path as everything else,
  then the process exits — Render's own restart-on-crash still applies, but the failure is visible
  first.
- `GET /health` (`apps/server/src/lib/health.ts`) now actually pings Postgres and Redis with a
  2-second timeout each, rather than returning a bare `200` unconditionally. Returns `503` with
  `{status: "degraded", checks: {db, redis}}` if either is unreachable, so Render's own health check
  can distinguish "up but can't serve requests" from genuinely healthy.

## 5. Logging & PII

- Structured log lines that name themselves `metric: "..."` (`apps/server/src/lib/metrics.ts`) never
  include message content, only IDs/sizes/reasons — this is the same discipline `RETENTION.md`
  requires of the purge paths, extended to the Phase 8 crash-safety metrics.
- **Sentry** (`apps/server/src/lib/sentry.ts`) is wired for error tracking, satisfying
  [ADR-0001](ADR/0001-stack.md)'s "PII scrubbing configured from day one, not bolted on later"
  commitment: `sendDefaultPii: false` (no IP address, cookie, or request body attached
  automatically) plus a `beforeSend` hook that strips `authorization`/`cookie` headers from whatever
  request context does get attached. Captures fire from three places: the global error handler's
  5xx branch, and both `uncaughtException`/`unhandledRejection` guards (flushed to Sentry before the
  process exits, so a crash's own event isn't dropped mid-flight). `SENTRY_DSN` is optional — local
  dev runs fine without it, and every event is tagged with `NODE_ENV` so one DSN safely covers both
  dev and prod, filterable by environment in Sentry's dashboard.
- Sentry is also the alerting surface for `RETENTION.md` §7's monitoring requirement: a
  `retention_violation_total` report (fatal level) if the sweeper ever leaves an envelope older than
  `RETENTION_WINDOW_DAYS` — see `modules/relay/retention-monitor.ts`.

## 6. Device linking (P2P history transfer)

[ADR-0008](ADR/0008-device-linking-protocol.md)'s pairing code: 8 digits, Redis-only state, 120-second
TTL, capped at 8 wrong-account attempts before the session is invalidated — not brute-forceable via
code length alone within that window. The actual history transfer happens over a direct WebRTC data
channel (DTLS-encrypted) the server never touches.

## 7. Known, accepted gaps (not defects — documented trade-offs)

- No end-to-end encryption yet — explicitly stretch-backlog, not a Phase 0–13 MVP/MVP+ requirement
  (see `docs/ROADMAP.md`'s Stretch section and ADR-0002's "Alternatives considered" on why retention
  limits and E2EE are treated as complementary, not substitutes).
- Several narrow, low-consequence races are accepted rather than solved with exhaustive state
  machines — catalogued across [ADR-0009](ADR/0009-media-attachments.md) (orphaned R2 object if
  upload succeeds but `message:send` never happens), [ADR-0011](ADR/0011-presence-and-receipts.md)
  (a device offline at the exact instant of a delivery/read transition misses that one tick), and
  `packages/local-store`'s sender/incoming-envelope race. None of these leak message content or
  survive past the retention window; they're UI-freshness gaps, not retention or security defects.
- `JWT_SECRET`, `DATABASE_URL`, etc. are plain environment variables on Render/Vercel, not a secrets
  manager — acceptable at this scale/budget; would be the first thing to reconsider if this ever
  moved to a team/multi-environment setup.
