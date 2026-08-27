import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import type { R2Context } from "../../plugins/app-context.js";
import { isOwnedAvatarKey, resolveAvatarUrl } from "./avatar.service.js";

// getSignedUrl computes a signature locally from the client's config — no network call is made, so
// a real S3Client with dummy credentials is safe and fast to use directly, same as
// modules/media/media.service.ts's tests use a fake client only where an actual send() would occur.
const r2: R2Context = {
  client: new S3Client({ region: "auto", endpoint: "https://example.r2.cloudflarestorage.com", credentials: { accessKeyId: "id", secretAccessKey: "secret" } }),
  bucket: "test-bucket",
};

describe("isOwnedAvatarKey", () => {
  it("is true for a bare R2 key", () => {
    expect(isOwnedAvatarKey("avatars/user-1/abc")).toBe(true);
  });

  it("is false for an external http(s) URL", () => {
    expect(isOwnedAvatarKey("https://avatars.githubusercontent.com/u/1")).toBe(false);
    expect(isOwnedAvatarKey("http://example.com/avatar.png")).toBe(false);
  });

  it("is false for null", () => {
    expect(isOwnedAvatarKey(null)).toBe(false);
  });
});

describe("resolveAvatarUrl", () => {
  it("returns null unchanged", async () => {
    expect(await resolveAvatarUrl(r2, null)).toBeNull();
  });

  it("passes an external URL through completely unsigned", async () => {
    const external = "https://avatars.githubusercontent.com/u/1";
    expect(await resolveAvatarUrl(r2, external)).toBe(external);
  });

  it("mints a presigned GET URL for a bare R2 key", async () => {
    const resolved = await resolveAvatarUrl(r2, "avatars/user-1/abc");
    expect(resolved).toContain("test-bucket");
    expect(resolved).toContain("avatars/user-1/abc");
    expect(resolved).toContain("X-Amz-Signature");
  });
});
