import { describe, expect, it } from "vitest";

import { conversationDisplayName } from "./conversation-name";
import type { Conversation } from "./types";

function conversation(overrides: Partial<Conversation>): Conversation {
  return { id: "c1", type: "direct", createdAt: "2026-01-01T00:00:00.000Z", members: [], ...overrides };
}

describe("conversationDisplayName", () => {
  it("shows the other member's name for a direct chat", () => {
    const result = conversationDisplayName(
      conversation({
        type: "direct",
        members: [
          { userId: "me", displayName: "Me" },
          { userId: "them", displayName: "Alice" },
        ],
      }),
      "me",
    );
    expect(result).toBe("Alice");
  });

  it("joins every other member's name for a group chat", () => {
    const result = conversationDisplayName(
      conversation({
        type: "group",
        members: [
          { userId: "me", displayName: "Me" },
          { userId: "a", displayName: "Alice" },
          { userId: "b", displayName: "Bob" },
        ],
      }),
      "me",
    );
    expect(result).toBe("Alice, Bob");
  });

  it("falls back to 'Just you' for a group with no other members", () => {
    const result = conversationDisplayName(conversation({ type: "group", members: [{ userId: "me", displayName: "Me" }] }), "me");
    expect(result).toBe("Just you");
  });
});
