import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

export interface AccessTokenClaims {
  userId: string;
  deviceId: string;
}

export async function signAccessToken(
  claims: AccessTokenClaims,
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ deviceId: claims.deviceId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(new TextEncoder().encode(secret));
}

export async function verifyAccessToken(
  token: string,
  secret: string,
): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (typeof payload.sub !== "string" || typeof payload.deviceId !== "string") {
    throw new Error("Malformed access token payload");
  }
  return { userId: payload.sub, deviceId: payload.deviceId };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateRefreshToken(ttlDays: number): {
  token: string;
  hash: string;
  expiresAt: Date;
} {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  return { token, hash: hashRefreshToken(token), expiresAt };
}
