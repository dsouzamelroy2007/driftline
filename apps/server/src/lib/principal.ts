import { devices, users, type Db, type Device, type User } from "@driftline/db";
import { and, eq, isNull } from "drizzle-orm";

import type { AccessTokenClaims } from "./tokens.js";

export interface Principal {
  user: User;
  device: Device;
}

// Re-checks device revocation against the database on every use (ADR-0004 §3 — revocation must be
// immediate, not wait for the access token to expire). Shared by HTTP auth (plugins/auth-plugin.ts)
// and the Socket.IO handshake (modules/relay/socket.ts) so there is exactly one verification path,
// per ADR-0004 §1.
export async function resolvePrincipal(db: Db, claims: AccessTokenClaims): Promise<Principal | null> {
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.id, claims.deviceId), isNull(devices.revokedAt)))
    .limit(1);
  if (!device) return null;

  const [user] = await db.select().from(users).where(eq(users.id, claims.userId)).limit(1);
  if (!user) return null;

  return { user, device };
}
