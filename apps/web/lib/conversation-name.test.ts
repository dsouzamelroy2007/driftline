import { describe, expect, it } from "vitest";

import { conversationAvatarUrl, conversationDisplayName } from "./conversation-name";
import type { Conversation, ConversationMemberSummary } from "./types";

function conversation(overrides: Partial<Conversation>): Conversation {
  return { id: "c1", type: "direct", createdAt: "2026-01-01T00:00:00.000Z", members: [], ...overrides };
}

function member(userId: string, displayName: string, avatarUrl: string | null = null): ConversationMemberSummary {
  return { userId, displayName, avatarUrl };
}

describe("conversationDisplayName", () => {
  it("shows the other member's name for a direct chat", () => {
    const result = conversationDisplayName(
      conversation({
        type: "direct",
        members: [member("me", "Me"), member("them", "Alice")],
      }),
      "me",
    );
    expect(result).toBe("Alice");
  });

  it("joins every other member's name for a group chat", () => {
    const result = conversationDisplayName(
      conversation({
        type: "group",
        members: [member("me", "Me"), member("a", "Alice"), member("b", "Bob")],
      }),
      "me",
    );
    expect(result).toBe("Alice, Bob");
  });

  it("falls back to 'Just you' for a group with no other members", () => {
    const result = conversationDisplayName(conversation({ type: "group", members: [member("me", "Me")] }), "me");
    expect(result).toBe("Just you");
  });
});

describe("conversationAvatarUrl", () => {
  it("returns the other member's avatar for a direct chat", () => {
    const result = conversationAvatarUrl(
      conversation({
        type: "direct",
        members: [member("me", "Me"), member("them", "Alice", "https://example.com/alice.png")],
      }),
      "me",
    );
    expect(result).toBe("https://example.com/alice.png");
  });

  it("returns null for a group, even when a member has an avatar", () => {
    const result = conversationAvatarUrl(
      conversation({
        type: "group",
        members: [member("me", "Me"), member("a", "Alice", "https://example.com/alice.png")],
      }),
      "me",
    );
    expect(result).toBeNull();
  });

  it("returns null when the other member has no avatar", () => {
    const result = conversationAvatarUrl(
      conversation({ type: "direct", members: [member("me", "Me"), member("them", "Alice")] }),
      "me",
    );
    expect(result).toBeNull();
  });
});
