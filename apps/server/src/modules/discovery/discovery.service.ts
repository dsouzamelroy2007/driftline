import type { Redis } from "ioredis";

const DISCOVERY_KEY_PREFIX = "discovery:server:";
const HEARTBEAT_TTL_SECONDS = 30;

/**
 * Registers this server instance in Redis with a heartbeat TTL and keeps
 * refreshing it — the free-tier equivalent of the reference design's
 * ZooKeeper registration (see docs/DESIGN_REVIEW.md). Returns a stop function.
 */
export function startDiscoveryHeartbeat(redis: Redis, instanceId: string, host: string): () => void {
  const key = `${DISCOVERY_KEY_PREFIX}${instanceId}`;
  const beat = (): void => {
    void redis.set(key, host, "EX", HEARTBEAT_TTL_SECONDS);
  };
  beat();
  const interval = setInterval(beat, (HEARTBEAT_TTL_SECONDS / 2) * 1000);
  interval.unref();
  return () => clearInterval(interval);
}

export async function getAvailableHost(redis: Redis): Promise<string | null> {
  // KEYS is fine at this registry's size (one chat server for MVP); revisit
  // with SCAN if/when there's ever more than a handful of instances.
  const [key] = await redis.keys(`${DISCOVERY_KEY_PREFIX}*`);
  if (!key) {
    return null;
  }
  return redis.get(key);
}
