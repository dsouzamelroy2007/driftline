import { describe, expect, it } from "vitest";

import { formatLastSeen } from "./format-last-seen";

describe("formatLastSeen", () => {
  it("returns 'Offline' for null", () => {
    expect(formatLastSeen(null)).toBe("Offline");
  });

  it("says 'just now' for under a minute", () => {
    expect(formatLastSeen(new Date(Date.now() - 30_000).toISOString())).toBe("Last seen just now");
  });

  it("shows minutes for under an hour", () => {
    expect(formatLastSeen(new Date(Date.now() - 5 * 60_000).toISOString())).toBe("Last seen 5 minutes ago");
  });

  it("shows hours for under a day", () => {
    expect(formatLastSeen(new Date(Date.now() - 3 * 60 * 60_000).toISOString())).toBe("Last seen 3 hours ago");
  });

  it("shows days for under a week", () => {
    expect(formatLastSeen(new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString())).toBe("Last seen 2 days ago");
  });

  it("falls back to a date for a week or more", () => {
    const lastSeenAt = new Date(Date.now() - 10 * 24 * 60 * 60_000).toISOString();
    expect(formatLastSeen(lastSeenAt)).toBe(`Last seen on ${new Date(lastSeenAt).toLocaleDateString()}`);
  });
});
