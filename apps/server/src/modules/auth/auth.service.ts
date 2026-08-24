import { devices, users, type Db, type Device, type User } from "@driftline/db";
import { and, eq, isNull } from "drizzle-orm";

import { HttpError } from "../../lib/errors.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "../../lib/tokens.js";
import type { DeviceInfo, LoginInput, RegisterInput } from "./auth.schemas.js";

export interface AuthEnv {
  JWT_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_DAYS: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult extends TokenPair {
  user: User;
  device: Device;
}

export async function upsertDevice(db: Db, userId: string, info: DeviceInfo): Promise<Device> {
  if (info.deviceId) {
    const [existing] = await db
      .select()
      .from(devices)
      .where(and(eq(devices.id, info.deviceId), eq(devices.userId, userId), isNull(devices.revokedAt)))
      .limit(1);

    if (existing) {
      // Updating by a row's own id always returns exactly one row.
      const [updated] = await db
        .update(devices)
        .set({
          lastSeenAt: new Date(),
          dormantAt: null,
          platform: info.platform,
          publicKey: info.publicKey ?? existing.publicKey,
        })
        .where(eq(devices.id, existing.id))
        .returning();
      return updated!;
    }
  }

  // No reusable device sent (first login, revoked device, or unrecognized id) —
  // mint a new one rather than erroring, per Phase 2 plan.
  const [created] = await db
    .insert(devices)
    .values({ userId, platform: info.platform, publicKey: info.publicKey, lastSeenAt: new Date() })
    .returning();
  return created!;
}

export async function issueTokenPair(
  db: Db,
  userId: string,
  deviceId: string,
  env: AuthEnv,
): Promise<TokenPair> {
  const accessToken = await signAccessToken({ userId, deviceId }, env.JWT_SECRET, env.JWT_ACCESS_TTL_SECONDS);
  const { token: refreshToken, hash, expiresAt } = generateRefreshToken(env.JWT_REFRESH_TTL_DAYS);

  await db
    .update(devices)
    .set({ refreshTokenHash: hash, refreshTokenExpiresAt: expiresAt, lastSeenAt: new Date() })
    .where(eq(devices.id, deviceId));

  return { accessToken, refreshToken };
}

export async function registerUser(db: Db, input: RegisterInput, env: AuthEnv): Promise<AuthResult> {
  const [existing] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  if (existing) {
    throw new HttpError(409, "Email already registered");
  }

  const passwordHash = await hashPassword(input.password);
  // A single insert always returns exactly one row.
  const [inserted] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, displayName: input.displayName })
    .returning();
  const user = inserted!;

  const device = await upsertDevice(db, user.id, input.device);
  const tokens = await issueTokenPair(db, user.id, device.id, env);
  return { user, device, ...tokens };
}

export async function loginUser(db: Db, input: LoginInput, env: AuthEnv): Promise<AuthResult> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  // No passwordHash means an OAuth-/magic-link-only account — treat the same as
  // a wrong password rather than a distinct error, so the response never
  // reveals which auth method an account uses.
  if (!user || !user.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new HttpError(401, "Invalid email or password");
  }

  const device = await upsertDevice(db, user.id, input.device);
  const tokens = await issueTokenPair(db, user.id, device.id, env);
  return { user, device, ...tokens };
}

export async function refreshTokens(db: Db, refreshToken: string, env: AuthEnv): Promise<TokenPair> {
  const hash = hashRefreshToken(refreshToken);
  const [device] = await db
    .select()
    .from(devices)
    .where(and(eq(devices.refreshTokenHash, hash), isNull(devices.revokedAt)))
    .limit(1);

  if (!device || !device.refreshTokenExpiresAt || device.refreshTokenExpiresAt < new Date()) {
    throw new HttpError(401, "Invalid or expired refresh token");
  }

  return issueTokenPair(db, device.userId, device.id, env);
}

// Ends the current session without revoking the device — the device can log in
// again later. Permanent removal is DELETE /devices/:id (see devices.service.ts).
export async function logoutDevice(db: Db, deviceId: string): Promise<void> {
  await db
    .update(devices)
    .set({ refreshTokenHash: null, refreshTokenExpiresAt: null })
    .where(eq(devices.id, deviceId));
}
