import { sql } from "drizzle-orm";

import { MIGRATIONS } from "./migrations-data.js";
import type { LocalStoreDb } from "./types.js";

// Neither backend has an external process to run a migration script against ahead of time (unlike
// packages/db's Postgres migrate.ts) — a device's local file persists across app updates, so
// pending migrations are applied in-process, every time the store opens. Bookkeeping mirrors
// drizzle's own Postgres migrator: a table tracking which migrations have already run.
export async function applyMigrations(db: LocalStoreDb): Promise<void> {
  await db.run(sql.raw("CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)"));

  // A raw sql`` query has no drizzle `fields` metadata to map by, so drizzle-orm/sqlite-proxy
  // returns each row exactly as the backend driver produced it — a positional array, not a
  // {name: ...} object (that mapping only happens for query-builder chains like .select().from()).
  // Reading `row.name` here silently returned undefined for every row, so appliedNames was always
  // empty and every migration re-ran on every store open — harmless for a fresh :memory: store
  // (nothing to conflict with), but a hard CREATE TABLE failure the moment a real persisted store
  // (OPFS in the browser, a file path in Node) is reopened. Caught by a live browser OPFS check,
  // not by the Node test suite, which only ever exercised fresh in-memory stores.
  const applied = await db.all<[string]>(sql`SELECT name FROM __migrations`);
  const appliedNames = new Set(applied.map((row) => row[0]));

  for (const migration of MIGRATIONS) {
    if (appliedNames.has(migration.name)) continue;
    for (const statement of migration.statements) {
      await db.run(sql.raw(statement));
    }
    await db.run(sql`INSERT INTO __migrations (name, applied_at) VALUES (${migration.name}, ${Date.now()})`);
  }
}
