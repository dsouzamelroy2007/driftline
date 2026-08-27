import {
  conversationMembers,
  conversationSequences,
  conversations,
  devices,
  users,
  type Conversation,
  type Db,
} from "@driftline/db";
import { and, eq, inArray, isNull } from "drizzle-orm";

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
  // Phase 6 part 5 (docs/ADR/0011-presence-and-receipts.md) — a snapshot resolved fresh on every
  // call; presence:update carries live changes while a client stays connected.
  online: boolean;
  lastSeenAt: string | null;
}

// Conversations carry no name column (a group's display name is derived client-side from this
// list — see docs/ADR for the deferred "custom group name" schema change), so every conversation
// the client fetches needs its member roster attached.
export interface ConversationWithMembers extends Conversation {
  members: ConversationMemberSummary[];
}

async function attachMembers(
  db: Db,
  r2: R2Context,
  conversationList: Conversation[],
  isOnline: (userId: string) => boolean,
): Promise<ConversationWithMembers[]> {
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

  const memberUserIds = [...new Set(rows.map((row) => row.userId))];
  // MAX(lastSeenAt) per user done in JS rather than a SQL GROUP BY — the dataset here is at most
  // 100 members * a handful of devices each, and this avoids relying on Drizzle's aggregate-function
  // API for what's otherwise a small, one-off reduction.
  const deviceRows =
    memberUserIds.length > 0
      ? await db
          .select({ userId: devices.userId, lastSeenAt: devices.lastSeenAt })
          .from(devices)
          .where(and(inArray(devices.userId, memberUserIds), isNull(devices.revokedAt)))
      : [];
  const lastSeenByUser = new Map<string, Date>();
  for (const row of deviceRows) {
    const existing = lastSeenByUser.get(row.userId);
    if (!existing || row.lastSeenAt > existing) lastSeenByUser.set(row.userId, row.lastSeenAt);
  }

  const membersByConversation = new Map<string, ConversationMemberSummary[]>();
  for (const row of rows) {
    const list = membersByConversation.get(row.conversationId) ?? [];
    list.push({
      userId: row.userId,
      displayName: row.displayName,
      avatarUrl: await resolveAvatarUrl(r2, row.avatarUrl),
      online: isOnline(row.userId),
      lastSeenAt: lastSeenByUser.get(row.userId)?.toISOString() ?? null,
    });
    membersByConversation.set(row.conversationId, list);
  }

  return conversationList.map((conversation) => ({
    ...conversation,
    members: membersByConversation.get(conversation.id) ?? [],
  }));
}

export async function createConversation(
  db: Db,
  r2: R2Context,
  input: CreateConversationInput,
  isOnline: (userId: string) => boolean,
): Promise<ConversationWithMembers> {
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

  const [withMembers] = await attachMembers(db, r2, [created], isOnline);
  return withMembers!;
}

export async function listConversationsForUser(
  db: Db,
  r2: R2Context,
  userId: string,
  isOnline: (userId: string) => boolean,
): Promise<ConversationWithMembers[]> {
  const rows = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(eq(conversationMembers.userId, userId));
  return attachMembers(
    db,
    r2,
    rows.map((row) => row.conversation),
    isOnline,
  );
}

export async function isConversationMember(db: Db, conversationId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: conversationMembers.id })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

// Phase 6 part 5 (docs/ADR/0011-presence-and-receipts.md): validates that `conversationId` is both
// type "direct" and that `userId` is actually a member of it, in one query — returns the *other*
// member's userId, or null if either check fails. Read receipts only ever need this one lookup.
export async function getDirectConversationOtherMember(db: Db, conversationId: string, userId: string): Promise<string | null> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversations.type, "direct")));

  if (rows.length !== 2 || !rows.some((row) => row.userId === userId)) return null;
  return rows.find((row) => row.userId !== userId)?.userId ?? null;
}
