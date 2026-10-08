import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { Cursor } from "../../common/cursor";
import { db } from "../../db/client";
import { urls, type Url } from "../../db/schema";

/** Fields needed to create a link. */
export interface CreateLinkData {
  publicId: string;
  originalUrl: string;
  organizationId: string;
  userId: string;
  code: string;
  title?: string;
  description?: string;
  expiresAt?: Date;
  redirectType?: 301 | 302;
}

/** Columns PATCH may change; `null` clears a nullable column. */
export type UpdateLinkFields = Partial<{
  originalUrl: string;
  code: string;
  title: string | null;
  description: string | null;
  expiresAt: Date | null;
  redirectType: 301 | 302;
}>;

export type LinkSort = "createdAt" | "clicks";

/** One keyset page request. `cursor.k` is already validated for `sort`. */
export interface ListLinksParams {
  organizationId: string;
  sort: LinkSort;
  order: "asc" | "desc";
  limit: number;
  cursor?: Cursor;
  /** Case-insensitive literal match on code, title or URL. */
  q?: string;
  /** Only links created by this user. */
  userId?: string;
}

/** Live (not soft-deleted) links of one organization. */
const liveIn = (organizationId: string) =>
  and(eq(urls.organizationId, organizationId), isNull(urls.deletedAt));

/** Data-access layer for links. */
export class LinksRepository {
  /** Inserts a link; a taken `code` raises a unique violation (23505). */
  async create(data: CreateLinkData): Promise<Url> {
    const [row] = await db
      .insert(urls)
      .values({ ...data, expiresAt: data.expiresAt ?? null })
      .returning();
    return row;
  }

  /** Finds a live link by its short code (redirect path). */
  findByCode(code: string): Promise<Url | undefined> {
    return db.query.urls.findFirst({ where: and(eq(urls.code, code), isNull(urls.deletedAt)) });
  }

  /** Finds a live link by public id within an organization. */
  findByPublicId(organizationId: string, publicId: string): Promise<Url | undefined> {
    return db.query.urls.findFirst({
      where: and(liveIn(organizationId), eq(urls.publicId, publicId)),
    });
  }

  /** Updates a live link of the organization; undefined if none matched. */
  async update(
    id: number,
    organizationId: string,
    fields: UpdateLinkFields,
  ): Promise<Url | undefined> {
    const [row] = await db
      .update(urls)
      .set({ ...fields, updatedAt: new Date() })
      .where(and(eq(urls.id, id), liveIn(organizationId)))
      .returning();
    return row;
  }

  /**
   * One keyset page ordered by (sort key, public_id). Served by the
   * (organization_id, key, public_id) indexes, so deep pages cost the same as
   * the first.
   */
  list({ organizationId, sort, order, limit, cursor, q, userId }: ListLinksParams): Promise<Url[]> {
    const key = sort === "clicks" ? urls.clickCount : urls.createdAt;
    const dir = order === "desc" ? desc : asc;
    let after: SQL | undefined;
    if (cursor) {
      const k =
        sort === "clicks"
          ? sql`${Number(cursor.k)}::bigint`
          : sql`${String(cursor.k)}::timestamptz`;
      after =
        order === "desc"
          ? sql`(${key}, ${urls.publicId}) < (${k}, ${cursor.id})`
          : sql`(${key}, ${urls.publicId}) > (${k}, ${cursor.id})`;
    }
    const conds: (SQL | undefined)[] = [liveIn(organizationId), after];
    if (userId) conds.push(eq(urls.userId, userId));
    if (q) {
      // Literal match: escape LIKE wildcards and the escape char itself.
      const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
      conds.push(
        or(ilike(urls.code, like), ilike(urls.title, like), ilike(urls.originalUrl, like)),
      );
    }
    return db
      .select()
      .from(urls)
      .where(and(...conds))
      .orderBy(dir(key), dir(urls.publicId))
      .limit(limit);
  }

  /** Soft-deletes a link owned by the organization; true if a row was affected. */
  async softDelete(id: number, organizationId: string): Promise<boolean> {
    const deleted = await db
      .update(urls)
      .set({ deletedAt: new Date() })
      .where(and(eq(urls.id, id), liveIn(organizationId)))
      .returning({ id: urls.id });
    return deleted.length > 0;
  }
}

export const linksRepository = new LinksRepository();
