import {
  conversationMembers,
  conversationSequences,
  conversations,
  users,
  type Conversation,
  type Db,
} from "@driftline/db";
import { and, eq, inArray } from "drizzle-orm";

import { HttpError } from "../../lib/errors.js";

export interface CreateConversationInput {
  type: "direct" | "group";
  creatorId: string;
  participantUserIds: string[];
}

export async function createConversation(db: Db, input: CreateConversationInput): Promise<Conversation> {
  const memberIds = Array.from(new Set([input.creatorId, ...input.participantUserIds]));

  if (input.type === "direct" && memberIds.length !== 2) {
    throw new HttpError(400, "A direct conversation must have exactly two members");
  }
  if (memberIds.length > 100) {
    throw new HttpError(400, "Conversations are capped at 100 members");
  }

  const existingUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, memberIds));
  if (existingUsers.length !== memberIds.length) {
    throw new HttpError(400, "One or more participant user IDs do not exist");
  }

  return db.transaction(async (tx) => {
    const [conversation] = await tx.insert(conversations).values({ type: input.type }).returning();
    const created = conversation!;
    await tx.insert(conversationSequences).values({ conversationId: created.id, seq: 0 });
    await tx.insert(conversationMembers).values(
      memberIds.map((userId) => ({
        conversationId: created.id,
        userId,
        role: userId === input.creatorId ? ("admin" as const) : ("member" as const),
      })),
    );
    return created;
  });
}

export async function listConversationsForUser(db: Db, userId: string): Promise<Conversation[]> {
  const rows = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(eq(conversationMembers.userId, userId));
  return rows.map((row) => row.conversation);
}

export async function isConversationMember(db: Db, conversationId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
