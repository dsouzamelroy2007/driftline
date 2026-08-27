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
import type { R2Context } from "../../plugins/app-context.js";
import { resolveAvatarUrl } from "../users/avatar.service.js";

export interface CreateConversationInput {
  type: "direct" | "group";
  creatorId: string;
  participantUserIds: string[];
}

export interface ConversationMemberSummary {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}

// Conversations carry no name column (a group's display name is derived client-side from this
// list — see docs/ADR for the deferred "custom group name" schema change), so every conversation
// the client fetches needs its member roster attached.
export interface ConversationWithMembers extends Conversation {
  members: ConversationMemberSummary[];
}

async function attachMembers(db: Db, r2: R2Context, conversationList: Conversation[]): Promise<ConversationWithMembers[]> {
  if (conversationList.length === 0) return [];

  const conversationIds = conversationList.map((conversation) => conversation.id);
  const rows = await db
    .select({
      conversationId: conversationMembers.conversationId,
      userId: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    })
    .from(conversationMembers)
    .innerJoin(users, eq(conversationMembers.userId, users.id))
    .where(inArray(conversationMembers.conversationId, conversationIds));

  const membersByConversation = new Map<string, ConversationMemberSummary[]>();
  for (const row of rows) {
    const list = membersByConversation.get(row.conversationId) ?? [];
    list.push({ userId: row.userId, displayName: row.displayName, avatarUrl: await resolveAvatarUrl(r2, row.avatarUrl) });
    membersByConversation.set(row.conversationId, list);
  }

  return conversationList.map((conversation) => ({
    ...conversation,
    members: membersByConversation.get(conversation.id) ?? [],
  }));
}

export async function createConversation(db: Db, r2: R2Context, input: CreateConversationInput): Promise<ConversationWithMembers> {
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

  const created = await db.transaction(async (tx) => {
    const [conversation] = await tx.insert(conversations).values({ type: input.type }).returning();
    const row = conversation!;
    await tx.insert(conversationSequences).values({ conversationId: row.id, seq: 0 });
    await tx.insert(conversationMembers).values(
      memberIds.map((userId) => ({
        conversationId: row.id,
        userId,
        role: userId === input.creatorId ? ("admin" as const) : ("member" as const),
      })),
    );
    return row;
  });

  const [withMembers] = await attachMembers(db, r2, [created]);
  return withMembers!;
}

export async function listConversationsForUser(db: Db, r2: R2Context, userId: string): Promise<ConversationWithMembers[]> {
  const rows = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(eq(conversationMembers.userId, userId));
  return attachMembers(db, r2, rows.map((row) => row.conversation));
}

export async function isConversationMember(db: Db, conversationId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}
