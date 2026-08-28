import { Redis } from "ioredis";

import { logRedisError } from "./metrics.js";

export function createRedisClient(redisUrl: string): Redis {
  const redis = new Redis(redisUrl);
  redis.on("error", logRedisError);
  return redis;
}
