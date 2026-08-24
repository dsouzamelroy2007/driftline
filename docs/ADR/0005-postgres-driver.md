# ADR-0005: Postgres Driver — node-postgres over neon-http

**Status:** Accepted — 2026-08-25

## Context

`packages/db` was originally wired up in Phase 1/2 against `drizzle-orm/neon-http`
(`@neondatabase/serverless`), Neon's HTTP-based driver aimed at edge/serverless runtimes that can't
hold a persistent TCP connection (Vercel Edge Functions, Cloudflare Workers, etc.). It worked fine
for Phase 2's request/response auth routes.

Phase 3's ack-triggered purge (`docs/RETENTION.md` §3, `ADR-0002` point 3) requires a genuine
read-then-conditionally-delete: lock the envelope, flip one target row to `delivered`, count
remaining pending targets, and delete the envelope (cascading to its targets) only if that count is
zero — all atomically, and race-safe when two recipient devices ack the last two pending targets at
the same moment. `drizzle-orm/neon-http`'s `.transaction()` throws `"No transactions support in
neon-http driver"` at runtime — it has no interactive-transaction or row-locking support at all.

`apps/server` is a long-running Fastify process on Render, not an edge function. It was never
actually constrained the way `neon-http` is designed for — nothing about the deployment target
required the HTTP driver, it was simply the default reached for.

## Decision

Switch `packages/db`'s client (`createDbClient`) from `drizzle-orm/neon-http` to
`drizzle-orm/node-postgres`, backed by a `pg.Pool` against the same Neon connection string
(`DATABASE_URL`, `sslmode=require` — `pg`'s connection-string parsing enables TLS from that param
automatically, no extra config needed). This gives real `db.transaction()` support and
`SELECT ... FOR UPDATE` row locking, so the purge logic in `apps/server/src/modules/relay/` reads as
a plain, auditable transaction rather than a hand-written multi-CTE atomic statement.

`apps/web` does not import `@driftline/db` (it talks to `apps/server` over HTTP/Socket.IO, never
touches Postgres directly), so this change is isolated to `packages/db` and `apps/server`.

## Consequences

- `packages/db/scripts/migrate.ts` now uses `drizzle-orm/node-postgres/migrator` instead of the
  `neon-http` migrator; behavior is otherwise identical.
- A `pg.Pool` holds real connections open for the process lifetime, which is exactly what a
  long-running Render service should do — this is a better fit than the edge driver was, not just a
  workaround.
- If `apps/web` (or a future Vercel Edge/serverless consumer) ever needs direct Postgres access,
  it should reach for `neon-http` or `neon-websockets` itself rather than through
  `packages/db`'s `createDbClient` — that function is now specifically the "long-running process"
  client.

## Alternatives considered and rejected

- **Stay on `neon-http`, express the purge as one multi-CTE SQL statement**: a single Postgres
  statement is atomic without needing driver-level transaction support, and this was evaluated
  concretely (see `packages/db` PR history / conversation record). Rejected because the resulting SQL
  is dense and hard to review or extend, and the same limitation would resurface for any future
  feature needing multi-step atomicity — better to fix the driver mismatch once than work around it
  repeatedly.
- **`drizzle-orm/neon-serverless` (WebSocket driver)**: also supports transactions and would have been
  a smaller diff from the existing `@neondatabase/serverless` dependency. Rejected in favor of plain
  `node-postgres` because `apps/server` has no edge/serverless constraint to design around — the
  WebSocket driver's value proposition (works where raw TCP doesn't) doesn't apply here.
