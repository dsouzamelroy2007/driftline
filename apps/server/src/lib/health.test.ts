import type { Db } from "@driftline/db";
import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "./health.js";

function fakeDb(execute: () => Promise<unknown>): Db {
  return { execute } as unknown as Db;
}

function fakeRedis(ping: () => Promise<unknown>): Redis {
  return { ping } as unknown as Redis;
}

describe("checkHealth", () => {
  it("reports ok when both Postgres and Redis respond", async () => {
    const result = await checkHealth(fakeDb(() => Promise.resolve()), fakeRedis(() => Promise.resolve("PONG")));
    expect(result).toEqual({ status: "ok", checks: { db: "ok", redis: "ok" } });
  });

  it("reports degraded when Postgres is unreachable, even if Redis is fine", async () => {
    const result = await checkHealth(
      fakeDb(() => Promise.reject(new Error("connection refused"))),
      fakeRedis(() => Promise.resolve("PONG")),
    );
    expect(result).toEqual({ status: "degraded", checks: { db: "error", redis: "ok" } });
  });

  it("reports degraded when Redis is unreachable, even if Postgres is fine", async () => {
    const result = await checkHealth(
      fakeDb(() => Promise.resolve()),
      fakeRedis(() => Promise.reject(new Error("ECONNRESET"))),
    );
    expect(result).toEqual({ status: "degraded", checks: { db: "ok", redis: "error" } });
  });

  it("treats a hung dependency as an error rather than hanging the health check forever", async () => {
    vi.useFakeTimers();
    const hungDb = fakeDb(() => new Promise(() => {}));
    const promise = checkHealth(hungDb, fakeRedis(() => Promise.resolve("PONG")));
    await vi.advanceTimersByTimeAsync(2100);
    const result = await promise;
    expect(result).toEqual({ status: "degraded", checks: { db: "error", redis: "ok" } });
    vi.useRealTimers();
  });
});
