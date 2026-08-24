import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run migrations");
}

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

await migrate(db, { migrationsFolder: new URL("../migrations", import.meta.url).pathname });
await pool.end();

console.log("Migrations applied.");
