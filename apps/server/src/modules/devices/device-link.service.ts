import { randomInt } from "node:crypto";

import type { Redis } from "ioredis";

import { HttpError } from "../../lib/errors.js";

// docs/ADR/0008-device-linking-protocol.md. A pairing session is short-lived, Redis-only state
// (never touches Postgres) — it exists purely to rendezvous two of one user's own already-
// authenticated devices for a WebRTC handshake; the server never sees the history being transferred.
const PAIRING_TTL_SECONDS = 120;
const MAX_JOIN_ATTEMPTS = 8;
const CODE_LENGTH = 8;
const CODE_SPACE = 10 ** CODE_LENGTH;

export interface PairingSession {
  hostUserId: string;
  hostDeviceId: string;
  status: "waiting" | "matched";
  attempts: number;
  sourceDeviceId?: string;
}

function sessionKey(code: string): string {
  return `device-link:${code}`;
}

function generateCode(): string {
  return randomInt(0, CODE_SPACE).toString().padStart(CODE_LENGTH, "0");
}

export interface CreatePairingSessionResult {
  code: string;
  expiresAt: Date;
}

export async function createPairingSession(
  redis: Redis,
  hostUserId: string,
  hostDeviceId: string,
): Promise<CreatePairingSessionResult> {
  const session: PairingSession = { hostUserId, hostDeviceId, status: "waiting", attempts: 0 };

  // NX so a rare code collision with another still-open session just retries with a new code,
  // rather than clobbering it.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const result = await redis.set(sessionKey(code), JSON.stringify(session), "EX", PAIRING_TTL_SECONDS, "NX");
    if (result === "OK") {
      return { code, expiresAt: new Date(Date.now() + PAIRING_TTL_SECONDS * 1000) };
    }
  }
  throw new HttpError(500, "Couldn't allocate a pairing code — try again");
}

export interface JoinPairingSessionResult {
  hostDeviceId: string;
}

// Optimistic-locking join (WATCH/MULTI/EXEC — no Lua/EVAL, since this project's Redis is Upstash
// and EVAL support on managed Redis-compatible services is inconsistent; WATCH/MULTI is plain
// protocol-level Redis, safe to depend on). Two source devices racing to join the same code cannot
// both succeed: the loser's EXEC returns null (the watched key changed) and it retries, seeing the
// now-`matched` status and returning null to its caller.
//
// Every failure path — expired/unknown code, already matched, wrong account, attempts exhausted —
// returns the same `null`. The caller (socket.ts) must report one generic "invalid or expired code"
// message regardless of which case it was; there is no oracle for probing the code space.
export async function joinPairingSession(
  redis: Redis,
  code: string,
  joiningUserId: string,
  sourceDeviceId: string,
): Promise<JoinPairingSessionResult | null> {
  const key = sessionKey(code);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await redis.watch(key);
    const raw = await redis.get(key);
    if (!raw) {
      await redis.unwatch();
      return null;
    }

    const session = JSON.parse(raw) as PairingSession;
    if (session.status !== "waiting") {
      await redis.unwatch();
      return null;
    }

    const ttl = await redis.ttl(key);
    const safeTtl = ttl > 0 ? ttl : 1;

    if (session.hostUserId !== joiningUserId) {
      session.attempts += 1;
      const multi = redis.multi();
      if (session.attempts >= MAX_JOIN_ATTEMPTS) {
        multi.del(key);
      } else {
        multi.set(key, JSON.stringify(session), "EX", safeTtl);
      }
      const execResult = await multi.exec();
      if (execResult === null) continue; // watched key changed concurrently — retry
      return null;
    }

    session.status = "matched";
    session.sourceDeviceId = sourceDeviceId;
    const multi = redis.multi();
    multi.set(key, JSON.stringify(session), "EX", safeTtl);
    const execResult = await multi.exec();
    if (execResult === null) continue; // someone else raced us — retry and see the new state
    return { hostDeviceId: session.hostDeviceId };
  }

  return null;
}

export async function getPairingSession(redis: Redis, code: string): Promise<PairingSession | null> {
  const raw = await redis.get(sessionKey(code));
  return raw ? (JSON.parse(raw) as PairingSession) : null;
}

export async function cancelPairingSession(redis: Redis, code: string): Promise<void> {
  await redis.del(sessionKey(code));
}
