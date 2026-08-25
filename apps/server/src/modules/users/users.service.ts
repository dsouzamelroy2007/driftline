import { users, type Db, type User } from "@driftline/db";
import { eq } from "drizzle-orm";

export async function findUserByEmail(db: Db, email: string): Promise<User | undefined> {
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return user;
}

export async function updateDisplayName(db: Db, userId: string, displayName: string): Promise<User> {
  // Updating by a row's own id always returns exactly one row.
  const [updated] = await db.update(users).set({ displayName }).where(eq(users.id, userId)).returning();
  return updated!;
}
