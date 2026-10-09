import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { organization, user } from "./auth-schema";

// Authentication tables (user, session, account, verification, jwks) live in
// `auth-schema.ts` and are owned by Better Auth. Re-export them so the rest of
// the app and drizzle-kit see one combined schema.
export * from "./auth-schema";

/**
 * Shortened URLs. `publicId` is the stable API identity; `code` is the
 * editable path segment (custom or random) in one unique namespace.
 */
export const urls = pgTable(
  "urls",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // Immutable public identifier (`link_…`) used by the API; the bigserial id
    // stays internal.
    publicId: text("public_id").notNull().unique(),
    originalUrl: text("original_url").notNull(),
    code: text("code").notNull().unique(),
    title: text("title"),
    description: text("description"),
    // 301 (permanent) or 302 (temporary, default) — see redirect.controller.ts.
    redirectType: smallint("redirect_type").notNull().default(302),
    // Share-tag clicks (`/code/ig`) get utm_source/utm_medium for that platform.
    autoUtm: boolean("auto_utm").notNull().default(false),
    // Tenant that owns the link. All management operations are scoped to the
    // caller's active organization.
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // The member who created the link (for attribution within the org).
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    clickCount: bigint("click_count", { mode: "number" }).notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    // Millisecond precision so keyset cursors round-trip through a JS Date.
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    // Keyset pagination: (sort key, public_id) within an organization.
    index("urls_org_created_idx").on(t.organizationId, t.createdAt, t.publicId),
    index("urls_org_clicks_idx").on(t.organizationId, t.clickCount, t.publicId),
    index("urls_user_id_created_at_idx").on(t.userId, t.createdAt),
    // List filter by creator.
    index("urls_org_user_created_idx").on(t.organizationId, t.userId, t.createdAt),
    // `q` search: trigram indexes make ILIKE '%…%' an index scan.
    index("urls_code_trgm_idx").using("gin", t.code.op("gin_trgm_ops")),
    index("urls_title_trgm_idx").using("gin", t.title.op("gin_trgm_ops")),
    index("urls_original_url_trgm_idx").using("gin", t.originalUrl.op("gin_trgm_ops")),
    check("urls_redirect_type_check", sql`${t.redirectType} IN (301, 302)`),
  ],
);

/** One row per redirect, for analytics. */
export const clicks = pgTable(
  "clicks",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    urlId: bigint("url_id", { mode: "number" })
      .notNull()
      .references(() => urls.id, { onDelete: "cascade" }),
    ip: text("ip"),
    country: text("country"),
    state: text("state"),
    city: text("city"),
    browser: text("browser"),
    os: text("os"),
    device: text("device"),
    referer: text("referer"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    // Attributed platform ("instagram", "x", "unknown"…) and how it was
    // determined ("channel" | "utm" | "clickid" | "ua" | "referer" | "none").
    source: text("source"),
    sourceMethod: text("source_method"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clicks_url_id_idx").on(t.urlId)],
);

// Inferred row types for use across repositories/services.
export type User = typeof user.$inferSelect;
export type Url = typeof urls.$inferSelect;
export type Click = typeof clicks.$inferSelect;
