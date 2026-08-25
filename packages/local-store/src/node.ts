import { DatabaseSync } from "node:sqlite";

import { drizzle } from "drizzle-orm/sqlite-proxy";

import { applyMigrations } from "./migrate.js";
import * as schema from "./schema.js";
import type { LocalStoreDb } from "./types.js";

export interface NodeLocalStore {
  db: LocalStoreDb;
  close: () => void;
}

// node:sqlite (Node's built-in SQLite, stable flag-free on Node >=22.5 — this repo requires
// >=22.13) backs the test/dev store. Both this and browser.ts's sqlocal go through
// drizzle-orm/sqlite-proxy rather than a dedicated driver package: drizzle-orm/node-sqlite only
// exists in unreleased 1.0.0 release candidates as of this writing, not any stable release — see
// docs/ADR/0006-local-store-engine.md.
export async function createNodeLocalStore(location = ":memory:"): Promise<NodeLocalStore> {
  const sqlite = new DatabaseSync(location);

  const db: LocalStoreDb = drizzle(async (sqlText, params, method) => {
    const statement = sqlite.prepare(sqlText);

    if (method === "run") {
      statement.run(...params);
      return { rows: [] };
    }

    if (method === "get") {
      const row = statement.get(...params) as Record<string, unknown> | undefined;
      // The declared AsyncRemoteCallback type says `rows: any[]`, but drizzle-orm/sqlite-proxy's
      // own runtime (mapGetResult) treats a falsy `rows` as "no row found" for this method — an
      // empty array would be truthy and wrongly map to a row of all-undefined columns instead.
      return { rows: (row ? Object.values(row) : undefined) as unknown[] };
    }

    // "all" and "values": drizzle-orm/sqlite-proxy expects an array of rows, each row itself a
    // positional array of column values (not a keyed object) — see mapResultRow in
    // drizzle-orm/sqlite-proxy/session, which indexes rows by field position.
    const rows = statement.all(...params) as Record<string, unknown>[];
    return { rows: rows.map((row) => Object.values(row)) };
  }, { schema });

  await applyMigrations(db);

  return { db, close: () => sqlite.close() };
}
