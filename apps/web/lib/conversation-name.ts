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
