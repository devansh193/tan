import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client";

/**
 * Applies any pending SQL migrations from ./drizzle, then exits.
 * Run after `bun run db:generate`. For quick local dev you can instead use
 * `bun run db:push` to sync the schema without migration files.
 */
async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
