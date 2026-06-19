import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Registered accounts. Passwords are stored only as bcrypt hashes. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Refresh tokens, one row per issued token. We store a SHA-256 hash of the
 * token (never the raw value) so a DB leak cannot be replayed. Rotation revokes
 * the old row and inserts a new one; reuse of a revoked token revokes the whole
 * set for the user (theft signal).
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("refresh_tokens_user_id_idx").on(t.userId)],
);

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
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type Url = typeof urls.$inferSelect;
export type Click = typeof clicks.$inferSelect;
