import { describe, expect, it } from "vitest";

import { noticeCopyFor } from "./timeline-copy";

describe("noticeCopyFor", () => {
  it("names the exact sequence range for a gap", () => {
    const copy = noticeCopyFor({ kind: "gap", gapFromSeq: 5, gapToSeq: 8 });
    expect(copy.body).toContain("5–8");
    expect(copy.showRecoveryActions).toBe(true);
  });

  it("falls back to generic gap copy when the range is unknown", () => {
    const copy = noticeCopyFor({ kind: "gap", gapFromSeq: null, gapToSeq: null });
    expect(copy.body).not.toContain("undefined");
  });

  it("covers dormancy_return and history_start distinctly", () => {
    expect(noticeCopyFor({ kind: "dormancy_return", gapFromSeq: null, gapToSeq: null }).title).toBe("Welcome back");
    expect(noticeCopyFor({ kind: "history_start", gapFromSeq: null, gapToSeq: null }).title).toBe("History starts here");
  });

  it("rejects the 'message' kind, which isn't a system notice", () => {
    expect(() => noticeCopyFor({ kind: "message", gapFromSeq: null, gapToSeq: null })).toThrow();
  });
});
