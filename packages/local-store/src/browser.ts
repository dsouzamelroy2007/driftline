import { drizzle } from "drizzle-orm/sqlite-proxy";
import { SQLocalDrizzle } from "sqlocal/drizzle";

import { applyMigrations } from "./migrate.js";
import * as schema from "./schema.js";
import type { LocalStoreDb } from "./types.js";

export interface BrowserLocalStore {
  db: LocalStoreDb;
  close: () => Promise<void>;
}

// sqlocal wraps the official @sqlite.org/sqlite-wasm build, runs it in a dedicated Worker
// automatically, and persists via OPFS — requires COOP `same-origin` / COEP `require-corp`
// response headers for the fast OPFS path (see apps/web/next.config.js). Its own Drizzle adapter
// (sqlocal/drizzle) is a thin wrapper around exactly the same drizzle-orm/sqlite-proxy driver
// node.ts uses, which is why both backends share every line of schema.ts and repository.ts — see
// docs/ADR/0006-local-store-engine.md.
export async function createBrowserLocalStore(databasePath = "driftline.sqlite3"): Promise<BrowserLocalStore> {
  const client = new SQLocalDrizzle(databasePath);
  const db: LocalStoreDb = drizzle(client.driver, client.batchDriver, { schema });

  await applyMigrations(db);

  return { db, close: () => client.destroy() };
}
