import { devices, type Db, type Device } from "@driftline/db";
import { and, desc, eq } from "drizzle-orm";

export function listDevices(db: Db, userId: string): Promise<Device[]> {
  return db.select().from(devices).where(eq(devices.userId, userId)).orderBy(desc(devices.lastSeenAt));
}

export async function revokeDevice(db: Db, deviceId: string, userId: string): Promise<boolean> {
  const [revoked] = await db
    .update(devices)
    .set({ revokedAt: new Date(), refreshTokenHash: null, refreshTokenExpiresAt: null })
    .where(and(eq(devices.id, deviceId), eq(devices.userId, userId)))
    .returning();
  return Boolean(revoked);
}
