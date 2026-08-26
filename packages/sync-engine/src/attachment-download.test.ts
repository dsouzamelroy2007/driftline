import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadAttachment } from "./attachment-download.js";

function okResponse(bytes: Uint8Array): Response {
  return { ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes.buffer) } as unknown as Response;
}

describe("downloadAttachment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the base64-encoded bytes on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(new TextEncoder().encode("fake-image-bytes")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadAttachment("https://example.com/presigned");

    expect(result).toBe(btoa("fake-image-bytes"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on a transient failure and succeeds on a later attempt", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(okResponse(new TextEncoder().encode("ok-now")));
    vi.stubGlobal("fetch", fetchMock);

    const result = await downloadAttachment("https://example.com/presigned");

    expect(result).toBe(btoa("ok-now"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns undefined after every attempt fails, without throwing", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("still down"));
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await downloadAttachment("https://example.com/presigned");

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    consoleSpy.mockRestore();
  });

  it("treats a non-ok HTTP response as a failure, retried the same as a network error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response);
    vi.stubGlobal("fetch", fetchMock);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await downloadAttachment("https://example.com/presigned");

    expect(result).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    consoleSpy.mockRestore();
  });
});
