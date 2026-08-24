import { describe, expect, it } from "vitest";

import { generateRefreshToken, hashRefreshToken, signAccessToken, verifyAccessToken } from "./tokens.js";

const SECRET = "a".repeat(32);

describe("access tokens", () => {
  it("round-trips claims through sign and verify", async () => {
    const token = await signAccessToken({ userId: "user-1", deviceId: "device-1" }, SECRET, 60);
    const claims = await verifyAccessToken(token, SECRET);
    expect(claims).toEqual({ userId: "user-1", deviceId: "device-1" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAccessToken({ userId: "user-1", deviceId: "device-1" }, SECRET, 60);
    await expect(verifyAccessToken(token, "b".repeat(32))).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signAccessToken({ userId: "user-1", deviceId: "device-1" }, SECRET, -1);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });
});

describe("refresh tokens", () => {
  it("produces a hash that matches hashRefreshToken of the same token", () => {
    const { token, hash } = generateRefreshToken(30);
    expect(hashRefreshToken(token)).toBe(hash);
  });

  it("generates distinct tokens on each call", () => {
    const a = generateRefreshToken(30);
    const b = generateRefreshToken(30);
    expect(a.token).not.toBe(b.token);
  });

  it("sets an expiry roughly ttlDays in the future", () => {
    const { expiresAt } = generateRefreshToken(1);
    const deltaMs = expiresAt.getTime() - Date.now();
    expect(deltaMs).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThan(25 * 60 * 60 * 1000);
  });
});
