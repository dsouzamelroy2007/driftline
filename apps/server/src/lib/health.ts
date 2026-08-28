import { sql } from "drizzle-orm";
import type { Db } from "@driftline/db";
import type { Redis } from "ioredis";

const CHECK_TIMEOUT_MS = 2000;

function withTimeout(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

export interface HealthResult {
  status: "ok" | "degraded";
  checks: { db: "ok" | "error"; redis: "ok" | "error" };
}

// Render's own health check hits this — a bare 200 (the pre-Phase-8 behavior) can't tell a genuinely
// broken instance (DB/Redis unreachable) from a healthy one, so Render never restarts a stuck
// service that's up but can't actually serve requests. Each dependency gets a short timeout so a
// slow-but-alive dependency doesn't make this endpoint hang.
export async function checkHealth(db: Db, redis: Redis): Promise<HealthResult> {
  const [dbResult, redisResult] = await Promise.allSettled([
    withTimeout(db.execute(sql`SELECT 1`), CHECK_TIMEOUT_MS),
    withTimeout(redis.ping(), CHECK_TIMEOUT_MS),
  ]);

  const checks = {
    db: dbResult.status === "fulfilled" ? ("ok" as const) : ("error" as const),
    redis: redisResult.status === "fulfilled" ? ("ok" as const) : ("error" as const),
  };

  return {
    status: checks.db === "ok" && checks.redis === "ok" ? "ok" : "degraded",
    checks,
  };
}
