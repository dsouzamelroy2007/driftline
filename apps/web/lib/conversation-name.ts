import type { Conversation } from "./types";

// Conversations carry no name column (docs/ADR follow-up: adding one is a schema change deferred
// past this phase — see apps/server's conversations.service.ts comment). Direct chats show the
// other member; groups fall back to a joined member list.
export function conversationDisplayName(conversation: Conversation, selfUserId: string): string {
  const others = conversation.members.filter((member) => member.userId !== selfUserId);

  if (conversation.type === "direct") {
    return others[0]?.displayName ?? "Unknown";
  }

  if (others.length === 0) return "Just you";
  return others.map((member) => member.displayName).join(", ");
}

// Only meaningful for a direct chat — the other person's photo. A group has no single photo to
// show (no group-icon feature yet), so the Avatar component's initial-letter fallback from
// conversationDisplayName's joined-names string covers that case well enough for now.
export function conversationAvatarUrl(conversation: Conversation, selfUserId: string): string | null {
  if (conversation.type !== "direct") return null;
  const other = conversation.members.find((member) => member.userId !== selfUserId);
  return other?.avatarUrl ?? null;
}
