import { createHash, randomBytes } from "node:crypto";

import { users, type Db } from "@driftline/db";
import { eq } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Resend } from "resend";

import { sendMagicLinkEmail } from "../../lib/email.js";
import { HttpError } from "../../lib/errors.js";
import { issueTokenPair, upsertDevice, type AuthEnv, type AuthResult } from "./auth.service.js";
import type { DeviceInfo } from "./auth.schemas.js";

const MAGIC_LINK_TTL_SECONDS = 900;

interface StoredMagicLink {
  userId: string;
  device: DeviceInfo;
}

function magicLinkKey(token: string): string {
  return `magic-link:${createHash("sha256").update(token).digest("hex")}`;
}

interface MagicLinkEnv extends AuthEnv {
  WEB_ORIGIN: string;
  RESEND_FROM_EMAIL: string;
}

export async function requestMagicLink(
  db: Db,
  redis: Redis,
  resend: Resend,
  email: string,
  device: DeviceInfo,
  env: MagicLinkEnv,
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) {
    // Deliberately silent — same "don't confirm which emails exist" posture as
    // login's password-mismatch response.
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const stored: StoredMagicLink = { userId: user.id, device };
  await redis.set(magicLinkKey(token), JSON.stringify(stored), "EX", MAGIC_LINK_TTL_SECONDS);

  const link = `${env.WEB_ORIGIN}/auth/magic-link?token=${token}`;
  await sendMagicLinkEmail(resend, env.RESEND_FROM_EMAIL, email, link);
}

export async function verifyMagicLink(
  db: Db,
  redis: Redis,
  token: string,
  env: AuthEnv,
): Promise<AuthResult> {
  const raw = await redis.getdel(magicLinkKey(token));
  if (!raw) {
    throw new HttpError(401, "Invalid or expired magic link");
  }

  const { userId, device } = JSON.parse(raw) as StoredMagicLink;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) {
    throw new HttpError(401, "Invalid or expired magic link");
  }

  const deviceRow = await upsertDevice(db, user.id, device);
  const tokens = await issueTokenPair(db, user.id, deviceRow.id, env);
  return { user, device: deviceRow, ...tokens };
}
