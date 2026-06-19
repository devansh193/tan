import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env";
import * as schema from "./schema";

/**
 * Single shared connection pool for the process. Exposing the pool lets the
 * bootstrap code close it cleanly on shutdown.
 */
export const pool = new Pool({ connectionString: env.DATABASE_URL });

/** Drizzle client bound to our schema; imported by repositories. */
export const db = drizzle(pool, { schema });

export type Database = typeof db;

/**
 * A query executor: either the root client or an open transaction. Repository
 * methods accept this so callers can compose several writes atomically.
 */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];
