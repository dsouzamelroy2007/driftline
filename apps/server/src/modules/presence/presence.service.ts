import { conversationMembers, devices, type Db } from "@driftline/db";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

// "Active" mirrors modules/relay/envelopes.service.ts's sendEnvelope fan-out filter (not revoked,
// not dormant) — used to target envelope:delivered and presence:update at every device that could
// plausibly be connected right now. Emitting to an offline/nonexistent room is a Socket.IO no-op
// (docs/REALTIME_PROTOCOL.md §2), so there's no harm in including a currently-disconnected device.
export async function getActiveDeviceIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(eq(devices.userId, userId), isNull(devices.revokedAt), isNull(devices.dormantAt)));
  return rows.map((row) => row.id);
}

// Every distinct user who shares at least one conversation with userId — the "who should hear about
// this user's presence change" set (docs/ADR/0011-presence-and-receipts.md). A plain self-join, the
// same shape of query modules/relay/conversations.service.ts's attachMembers already runs.
export async function getConversationPartnerUserIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(
      and(
        inArray(
          conversationMembers.conversationId,
          db.select({ conversationId: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, userId)),
        ),
        ne(conversationMembers.userId, userId),
      ),
    );
  return rows.map((row) => row.userId);
}

// Every active device belonging to any of the given users — used to fan out presence:update to a
// whole set of "contacts" at once rather than one getActiveDeviceIds call per user.
export async function getActiveDeviceIdsForUsers(db: Db, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db
    .select({ id: devices.id })
    .from(devices)
    .where(and(inArray(devices.userId, userIds), isNull(devices.revokedAt), isNull(devices.dormantAt)));
  return rows.map((row) => row.id);
}
