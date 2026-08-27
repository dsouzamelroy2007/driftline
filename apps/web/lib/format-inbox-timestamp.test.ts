import { describe, expect, it } from "vitest";

import { formatInboxTimestamp } from "./format-inbox-timestamp";

describe("formatInboxTimestamp", () => {
  it("shows a time for something sent today", () => {
    const now = new Date();
    expect(formatInboxTimestamp(now)).toBe(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  });

  it("shows a weekday name for something sent within the last week", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
    expect(formatInboxTimestamp(threeDaysAgo)).toBe(threeDaysAgo.toLocaleDateString([], { weekday: "short" }));
  });

  it("shows a short date for anything older", () => {
    const twoWeeksAgo = new Date(Date.now() - 14 * 86_400_000);
    expect(formatInboxTimestamp(twoWeeksAgo)).toBe(twoWeeksAgo.toLocaleDateString([], { month: "short", day: "numeric" }));
  });
});
