import type { SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import type * as schema from "./schema.js";

export type LocalStoreDb = SqliteRemoteDatabase<typeof schema>;

// The type of the callback argument to db.transaction(async (tx) => ...) — for repository
// functions that must run as one step of a larger caller-owned transaction.
export type LocalStoreTx = Parameters<Parameters<LocalStoreDb["transaction"]>[0]>[0];
