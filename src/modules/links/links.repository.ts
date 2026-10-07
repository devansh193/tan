import { and, asc, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
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
  expiresAt?: Date;
}

export type LinkSort = "createdAt" | "clicks";

/** One keyset page request. `cursor.k` is already validated for `sort`. */
export interface ListLinksParams {
  organizationId: string;
  sort: LinkSort;
  order: "asc" | "desc";
  limit: number;
  cursor?: Cursor;
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

  /**
   * One keyset page ordered by (sort key, public_id). Served by the
   * (organization_id, key, public_id) indexes, so deep pages cost the same as
   * the first.
   */
  list({ organizationId, sort, order, limit, cursor }: ListLinksParams): Promise<Url[]> {
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
    return db
      .select()
      .from(urls)
      .where(and(liveIn(organizationId), after))
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
