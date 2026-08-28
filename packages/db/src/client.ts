import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

// apps/server is a long-running process (Render), not an edge/serverless function, so it uses a
// plain pooled Postgres connection rather than Neon's HTTP driver — the ack-triggered purge needs
// real transactions with row locking, which drizzle-orm/neon-http cannot provide (see ADR-0005).
export function createDbClient(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  // Neon's free-tier compute auto-suspends after idle and drops connections; without this listener
  // that shows up as an unhandled 'error' event on an idle pool client, which crashes the whole
  // Node process (Phase 8 hardening — this had never actually fired in practice, but was a live
  // risk on a long-running Render service the moment Neon suspended mid-idle).
  pool.on("error", (error) => {
    console.error(JSON.stringify({ metric: "pg_pool_error_total", message: error.message, ts: new Date().toISOString() }));
  });
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDbClient>;

// The type of the callback argument to db.transaction(async (tx) => ...) — for service functions
// that must run as one step of a larger caller-owned transaction (e.g. the ack-triggered purge
// helper shared between the ack path and device revocation).
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
