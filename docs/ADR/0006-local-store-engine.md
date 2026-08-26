# ADR-0006: Local Store Engine — SQLite Wasm (OPFS) over Dexie

**Status:** Accepted — 2026-08-25

## Context

`ADR-0001` deliberately deferred the web client-store engine choice: "SQLite-WASM on OPFS, or
Dexie/IndexedDB — decided in ADR accompanying Phase 4." Mobile (Phase 10) was already locked to
`expo-sqlite` + Drizzle + FTS5 for real SQL and on-device full-text search. Phase 4 needed to pick
the web engine and actually build `packages/local-store` (on-device chat history — the server never
has this, per `docs/RETENTION.md`) and `packages/sync-engine` (the logic that drives it from
`docs/REALTIME_PROTOCOL.md`, including client-side gap-notice detection, `ADR-0003` §3).

## Decision

**SQLite Wasm, OPFS-backed**, via the official `@sqlite.org/sqlite-wasm` build (wrapped by
`sqlocal`, which runs it in a dedicated Worker automatically) — not Dexie. This lets
`packages/local-store` share one Drizzle SQL schema and one repository/query layer with the future
mobile package, matching `ADR-0001`'s own reasoning for choosing SQLite on mobile in the first
place: same SQL, same FTS5 search path, one mental model across platforms.

Concretely, both the browser and the Node (test) backend go through
**`drizzle-orm/sqlite-proxy`** — not a dedicated per-backend driver package:

- **Browser** (`src/browser.ts`): `sqlocal/drizzle`'s `SQLocalDrizzle` client provides a
  `driver`/`batchDriver` pair that already matches `sqlite-proxy`'s callback contract exactly —
  `sqlocal/drizzle` is in fact just a thin re-export of `drizzle-orm/sqlite-proxy`'s `drizzle()`
  wired to those callbacks. Requires COOP `same-origin` / COEP `require-corp` response headers for
  the fast OPFS `SyncAccessHandle` path (`apps/web/next.config.ts`).
- **Node** (`src/node.ts`, tests): Node's built-in `node:sqlite` (`DatabaseSync`, stable flag-free
  on Node ≥22.5 — this repo requires ≥22.13), wrapped in a small callback matching the same
  `sqlite-proxy` contract by hand. **This is a deliberate pivot from the plan drafted going into
  implementation**, which assumed `drizzle-orm/node-sqlite` (a dedicated driver) existed — verified
  during implementation that it only exists in unreleased `drizzle-orm@1.0.0` release candidates,
  not any stable release (checked directly against the published npm packages). Rather than pin a
  core dependency to a release candidate, both backends were unified on `sqlite-proxy`, which is
  arguably cleaner anyway: one driver mechanism, two thin executors, instead of two different
  driver packages with two different row-shape conventions to keep straight.

**Migrations**: `drizzle-kit generate` works for the `sqlite` dialect directly from `schema.ts` —
verified empirically, no live driver or `dbCredentials` needed at all (unlike the Postgres dialect's
`generate`, which also doesn't need one, but this was checked explicitly since the initial plan
assumed otherwise). The generated `.sql` files are bundled into `src/migrations-data.ts` by
`scripts/build-migrations.ts` (run as part of `db:generate`), because neither runtime backend can
read files off disk — a device's local file persists across app updates, so a small hand-rolled
migrator (`src/migrate.ts`) applies any not-yet-applied migration in-process every time the store
opens, tracked in a `__migrations` bookkeeping table (mirroring drizzle's own Postgres migrator
pattern).

## Verification

- Full repository-level test suite (gap detection, outbox flush, dormancy fan-out, the two-device
  divergence property `ADR-0003` requires) runs against the Node backend — 14 tests in
  `packages/local-store`, 10 in `packages/sync-engine`, all green.
- **A real browser check** (headless Chromium via Playwright, driving the actual `browser.ts`
  through a Vite dev server configured with the same COOP/COEP headers `apps/web/next.config.ts`
  sets): wrote a row, did a full page reload (a genuinely new JS context and a new Worker, not just
  an in-memory illusion), read the row back. This caught a real bug that the Node test suite's
  always-fresh `:memory:` databases never exercised: `applyMigrations`'s bookkeeping read the wrong
  row shape for a raw (non-query-builder) `sql` call — `drizzle-orm/sqlite-proxy` only maps rows to
  `{column: value}` objects for query-builder chains that carry `fields` metadata; a raw
  `db.all(sql\`...\`)` call returns each row as a plain positional array instead. The bug meant
  `__migrations` was read as an array of `undefined` names, so every migration silently re-ran on
  every store open — invisible against a fresh in-memory database, but a hard `table already exists`
  crash the instant a persisted store was reopened. Fixed in `migrate.ts`, and a matching Node-side
  regression test (reopening a real file-backed `node:sqlite` database, not `:memory:`) was added so
  this class of bug is caught locally next time, not only by the browser check.

## Consequences

- `packages/local-store`'s `schema.ts` and `repository.ts` are 100% shared, driver-agnostic
  `drizzle-orm/sqlite-core` code — when Phase 10 builds the mobile package against `expo-sqlite`, it
  needs only its own thin `sqlite-proxy` executor (or a dedicated `expo-sqlite` driver, if one
  exists by then), not a schema or query-layer rewrite.
- The COOP/COEP headers apply site-wide in `apps/web/next.config.ts`, ahead of Phase 5 actually
  mounting a UI on top of this — cheap to set now, and it's the kind of easy-to-forget requirement
  that's better locked in before there's a page that would silently degrade without it.
- No fallback to Dexie was needed — `sqlocal`/OPFS worked as expected once the Vite dev-server
  wiring for its Worker was correct (an artifact of this being a Vite-based verification harness,
  not a Next.js-specific issue; `apps/web`'s Next.js bundler is expected to handle the Worker
  correctly out of the box, to be confirmed when Phase 5 actually mounts a page on this).

## Update — Phase 6: FTS5 confirmed and implemented

This ADR's "same FTS5 search path" reasoning (Decision, above) was a bet at the time it was written
— chosen because SQLite generally supports FTS5, not because either backend had actually been
checked. Phase 6 verified it directly before building client-side search on top of it: both
`node:sqlite` (`node --experimental-sqlite`, a one-line spike) and `sqlocal`'s SQLite Wasm build (a
headless-Chromium Playwright check against a minimal Vite page importing `sqlocal` directly, same
harness style as the OPFS check above) successfully run `CREATE VIRTUAL TABLE ... USING fts5(...)`.
`packages/local-store`'s `searchTimeline` (a hand-written raw-SQL migration for the virtual table —
FTS5 virtual tables aren't expressible via `drizzle-kit generate`'s schema diffing, exactly as
anticipated above — with application-code population at insert time, since payloads are base64 and
no SQL trigger can decode them) is the result; see its own doc comments in `repository.ts` for the
full design, not repeated here.

## Alternatives considered and rejected

- **Dexie/IndexedDB**: rejected per the trade-off already named in `ADR-0001`'s deferred note — no
  FTS5-equivalent, and the web/mobile packages would share only a TypeScript interface, not an
  actual query layer.
- **`drizzle-orm/node-sqlite`** for the Node backend specifically: rejected after direct verification
  that it doesn't exist in any stable `drizzle-orm` release — see "Decision" above.
- **`wa-sqlite`** (lower-level, manual OPFS/IndexedDB VFS wiring) instead of `sqlocal`: rejected —
  `sqlocal` wraps the same official `@sqlite.org/sqlite-wasm` build with a maintained Drizzle
  adapter and automatic Worker management, strictly less code to own for the same result.
