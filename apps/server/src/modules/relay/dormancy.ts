import { devices, type Db } from "@driftline/db";
import { and, isNull, lt } from "drizzle-orm";

// docs/RETENTION.md §5: a device that hasn't connected for DEVICE_DORMANCY_DAYS is marked dormant
// and excluded from *new* fan-out (sendEnvelope's target query already filters on dormantAt IS
// NULL, so no other code path needs to change). The device row itself is never deleted here — see
// docs/RETENTION.md §8, an open question deferred to Phase 5.
export async function sweepDormantDevices(db: Db, dormancyDays: number): Promise<number> {
  const threshold = new Date(Date.now() - dormancyDays * 24 * 60 * 60 * 1000);

  const marked = await db
    .update(devices)
    .set({ dormantAt: new Date() })
    .where(and(lt(devices.lastSeenAt, threshold), isNull(devices.dormantAt), isNull(devices.revokedAt)))
    .returning({ id: devices.id });

  return marked.length;
}
