import { bigint, bigserial, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

// Authentication tables (user, session, account, verification, jwks) live in
// `auth-schema.ts` and are owned by Better Auth. Re-export them so the rest of
// the app and drizzle-kit see one combined schema.
export * from "./auth-schema";

/**
 * Shortened URLs. The `bigserial` id is the monotonic counter that drives
 * short-code generation: the default code is `sqids.encode([id])`. Because
 * Sqids is a bijection, that code is reversible and collision-free, so no slug
 * column or uniqueness check is needed. An optional `customAlias` provides a
 * user-chosen code that takes precedence on resolution.
 */
export const urls = pgTable(
  "urls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    originalUrl: text("original_url").notNull(),
    customAlias: text("custom_alias").unique(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clickCount: integer("click_count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("urls_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

/** One row per redirect, for analytics. IP is stored hashed for privacy. */
export const clicks = pgTable(
  "clicks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    urlId: bigint("url_id", { mode: "number" })
      .notNull()
      .references(() => urls.id, { onDelete: "cascade" }),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clicks_url_id_idx").on(t.urlId)],
);

// Inferred row types for use across repositories/services.
export type User = typeof user.$inferSelect;
export type Url = typeof urls.$inferSelect;
export type Click = typeof clicks.$inferSelect;
