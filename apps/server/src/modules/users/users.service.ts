import { users, type Db, type User } from "@driftline/db";
import { eq } from "drizzle-orm";

import { logAvatarCleanupFailed, logAvatarObjectReplaced } from "../../lib/metrics.js";
import { deleteR2Object } from "../../lib/r2-client.js";
import type { R2Context } from "../../plugins/app-context.js";
import { isOwnedAvatarKey } from "./avatar.service.js";

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function updateDisplayName(db: Db, userId: string, displayName: string): Promise<User> {
  // Updating by a row's own id always returns exactly one row.
  const [updated] = await db.update(users).set({ displayName }).where(eq(users.id, userId)).returning();
  return updated!;
}

// `avatarUrl` is either a bare R2 key (self-uploaded) or an external URL (OAuth-provided) — see
// docs/ADR/0010-profile-pictures.md. Pass `null` to remove the current avatar entirely. Deletes the
// previous R2 object best-effort once the DB write commits, but only if it was one we own (an
// external URL was never ours to delete) and it's actually being replaced by something different.
export async function updateAvatar(db: Db, r2: R2Context, userId: string, avatarUrl: string | null): Promise<User> {
  const [previous] = await db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, userId)).limit(1);
  const [updated] = await db.update(users).set({ avatarUrl }).where(eq(users.id, userId)).returning();

  const previousKey = previous?.avatarUrl ?? null;
  if (isOwnedAvatarKey(previousKey) && previousKey !== avatarUrl) {
    try {
      await deleteR2Object(r2.client, r2.bucket, previousKey);
      logAvatarObjectReplaced(previousKey);
    } catch (error) {
      logAvatarCleanupFailed(previousKey, error);
    }
  }

  return updated!;
}
