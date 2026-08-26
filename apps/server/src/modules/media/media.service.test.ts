import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { cleanupPurgedMedia, isMediaContentType, tryExtractR2Key } from "./media.service.js";

function base64Descriptor(descriptor: unknown): string {
  return Buffer.from(JSON.stringify(descriptor)).toString("base64");
}

describe("isMediaContentType", () => {
  it("accepts the allowed image types", () => {
    expect(isMediaContentType("image/jpeg")).toBe(true);
    expect(isMediaContentType("image/png")).toBe(true);
    expect(isMediaContentType("image/webp")).toBe(true);
    expect(isMediaContentType("image/gif")).toBe(true);
  });

  it("rejects anything else, including a text/plain that merely starts with 'image'-looking text", () => {
    expect(isMediaContentType("text/plain")).toBe(false);
    expect(isMediaContentType("application/octet-stream")).toBe(false);
    expect(isMediaContentType("image/svg+xml")).toBe(false); // not in the allowlist
  });
});

describe("tryExtractR2Key", () => {
  it("extracts the key from a well-formed descriptor", () => {
    const payload = base64Descriptor({ r2Key: "attachments/user-1/abc", size: 1234 });
    expect(tryExtractR2Key("image/jpeg", payload)).toBe("attachments/user-1/abc");
  });

  it("returns null for a non-media content type, even with a valid-looking descriptor", () => {
    const payload = base64Descriptor({ r2Key: "attachments/user-1/abc", size: 1234 });
    expect(tryExtractR2Key("text/plain", payload)).toBeNull();
  });

  it("never throws on a malformed/adversarial payload — always returns null instead", () => {
    expect(tryExtractR2Key("image/jpeg", "not-valid-base64!!!")).toBeNull();
    expect(tryExtractR2Key("image/jpeg", Buffer.from("not json").toString("base64"))).toBeNull();
    expect(tryExtractR2Key("image/jpeg", base64Descriptor({ size: 1234 }))).toBeNull(); // missing r2Key
    expect(tryExtractR2Key("image/jpeg", base64Descriptor({ r2Key: 42 }))).toBeNull(); // wrong type
    expect(tryExtractR2Key("image/jpeg", base64Descriptor(null))).toBeNull();
  });
});

describe("cleanupPurgedMedia", () => {
  function fakeClient() {
    return { send: vi.fn().mockResolvedValue({}) } as unknown as S3Client;
  }

  it("deletes the R2 object for a purged media envelope", async () => {
    const client = fakeClient();
    const payload = base64Descriptor({ r2Key: "attachments/user-1/abc", size: 1234 });

    await cleanupPurgedMedia(client, "test-bucket", { contentType: "image/jpeg", payload });

    expect(client.send).toHaveBeenCalledOnce();
  });

  it("is a no-op for a non-media envelope", async () => {
    const client = fakeClient();

    await cleanupPurgedMedia(client, "test-bucket", { contentType: "text/plain", payload: "aGVsbG8=" });

    expect(client.send).not.toHaveBeenCalled();
  });

  it("is a no-op when contentType/payload are missing (nothing was actually purged)", async () => {
    const client = fakeClient();

    await cleanupPurgedMedia(client, "test-bucket", {});

    expect(client.send).not.toHaveBeenCalled();
  });

  it("swallows an R2 delete failure rather than throwing — the Postgres purge already committed", async () => {
    const client = { send: vi.fn().mockRejectedValue(new Error("R2 is down")) } as unknown as S3Client;
    const payload = base64Descriptor({ r2Key: "attachments/user-1/abc", size: 1234 });

    await expect(cleanupPurgedMedia(client, "test-bucket", { contentType: "image/jpeg", payload })).resolves.toBeUndefined();
  });
});
