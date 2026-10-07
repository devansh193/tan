import { migrate } from "drizzle-orm/node-postgres/migrator";
import { encodeId } from "../modules/url/sqids";
import { generateCode } from "../modules/url/short-code";
import { db, pool } from "./client";

const PG_UNIQUE_VIOLATION = "23505";

/**
 * Links created before random codes existed were addressed by `sqids(id)`.
 * Store that code so old short links keep working. If a custom alias already
 * claims that code (the old alias-shadowing hijack), whichever link was created
 * first keeps it and the other gets a fresh random code.
 */
async function backfillLegacyCodes() {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM urls WHERE code IS NULL ORDER BY id`,
  );
  // ponytail: one UPDATE per legacy row; fine for a one-off backfill.
  for (const { id } of rows) {
    const legacy = encodeId(Number(id));
    try {
      await pool.query(`UPDATE urls SET code = $1 WHERE id = $2`, [legacy, id]);
    } catch (err) {
      if ((err as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw err;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // The alias row is newer than this link: it squatted an existing code.
        const { rows: squatter } = await client.query<{ id: string }>(
          `UPDATE urls a SET code = $1 FROM urls l
           WHERE a.code = $2 AND l.id = $3 AND a.created_at > l.created_at
           RETURNING a.id`,
          [generateCode(), legacy, id],
        );
        const code = squatter.length ? legacy : generateCode();
        await client.query(`UPDATE urls SET code = $1 WHERE id = $2`, [code, id]);
        await client.query("COMMIT");
        console.warn(
          squatter.length
            ? `url ${id}: reclaimed code ${legacy} from alias on url ${squatter[0].id}`
            : `url ${id}: legacy code ${legacy} predated by an alias, reassigned to ${code}`,
        );
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
  }
  await pool.query(`ALTER TABLE urls ALTER COLUMN code SET NOT NULL`);
  if (rows.length) console.log(`Backfilled ${rows.length} legacy short codes.`);
}

/**
 * Applies any pending SQL migrations from ./drizzle, then exits.
 * Run after `bun run db:generate`. For quick local dev you can instead use
 * `bun run db:push` to sync the schema without migration files.
 */
async function main() {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await backfillLegacyCodes();
  console.log("Migrations applied.");
  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
