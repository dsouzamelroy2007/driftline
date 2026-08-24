import { describe, expect, it } from "vitest";

import { pickPrimaryVerifiedEmail } from "./github.service.js";

describe("pickPrimaryVerifiedEmail", () => {
  it("prefers the verified primary email", () => {
    const email = pickPrimaryVerifiedEmail([
      { email: "secondary@example.com", primary: false, verified: true },
      { email: "primary@example.com", primary: true, verified: true },
    ]);
    expect(email).toBe("primary@example.com");
  });

  it("falls back to any verified email when none is marked primary", () => {
    const email = pickPrimaryVerifiedEmail([
      { email: "unverified@example.com", primary: true, verified: false },
      { email: "verified@example.com", primary: false, verified: true },
    ]);
    expect(email).toBe("verified@example.com");
  });

  it("returns null when no email is verified", () => {
    const email = pickPrimaryVerifiedEmail([
      { email: "unverified@example.com", primary: true, verified: false },
    ]);
    expect(email).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(pickPrimaryVerifiedEmail([])).toBeNull();
  });
});
