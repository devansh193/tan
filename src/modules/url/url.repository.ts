import { and, count, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { clicks, urls, type Click, type Url } from "../../db/schema";
import type { ClickData } from "./click-analytics";

/** Fields needed to create a URL. */
export interface CreateUrlData {
  originalUrl: string;
  organizationId: string;
  userId: string;
  code: string;
  expiresAt?: Date;
}

/** One click to persist, as buffered by the ClickRecorder. */
export interface ClickRow extends ClickData {
  urlId: number;
  createdAt: Date;
}

/** Data-access layer for shortened URLs and their click analytics. */
export class UrlRepository {
  /** Inserts a URL; a taken `code` raises a unique violation (23505). */
  async create(data: CreateUrlData): Promise<Url> {
    const [row] = await db
      .insert(urls)
      .values({
        originalUrl: data.originalUrl,
        organizationId: data.organizationId,
        userId: data.userId,
        code: data.code,
        expiresAt: data.expiresAt ?? null,
      })
      .returning();
    return row;
  }

  /** Finds a live (non-deleted) URL by its short code (alias or generated). */
  findByCode(code: string): Promise<Url | undefined> {
    return db.query.urls.findFirst({
      where: and(eq(urls.code, code), isNull(urls.deletedAt)),
    });
  }

  /** Lists an organization's live URLs, newest first, with pagination. */
  listByOrganization(organizationId: string, limit: number, offset: number): Promise<Url[]> {
    return db.query.urls.findMany({
      where: and(eq(urls.organizationId, organizationId), isNull(urls.deletedAt)),
      orderBy: desc(urls.createdAt),
      limit,
      offset,
    });
  }

  /** Total count of an organization's live URLs (for pagination metadata). */
  async countByOrganization(organizationId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(urls)
      .where(and(eq(urls.organizationId, organizationId), isNull(urls.deletedAt)));
    return row.value;
  }

  /** Soft-deletes a URL owned by the organization; true if a row was affected. */
  async softDelete(id: number, organizationId: string): Promise<boolean> {
    const deleted = await db
      .update(urls)
      .set({ deletedAt: new Date() })
      .where(and(eq(urls.id, id), eq(urls.organizationId, organizationId), isNull(urls.deletedAt)))
      .returning({ id: urls.id });
    return deleted.length > 0;
  }

  /**
   * Persists a batch of clicks: one multi-row insert plus one counter update per
   * distinct URL, so a hot link costs one row lock per batch, not per click.
   */
  async recordClicks(rows: ClickRow[]): Promise<void> {
    if (!rows.length) return;
    const perUrl = new Map<number, number>();
    for (const r of rows) perUrl.set(r.urlId, (perUrl.get(r.urlId) ?? 0) + 1);
    const deltas = sql.join(
      [...perUrl].map(([id, n]) => sql`(${id}::bigint, ${n}::bigint)`),
      sql`, `,
    );

    await db.transaction(async (tx) => {
      await tx.insert(clicks).values(rows);
      await tx.execute(sql`
        UPDATE ${urls} SET click_count = ${urls.clickCount} + d.n
        FROM (VALUES ${deltas}) AS d(id, n)
        WHERE ${urls.id} = d.id`);
    });
  }

  /** Deletes click analytics older than the cutoff (retention policy). */
  async deleteClicksBefore(cutoff: Date): Promise<number> {
    const result = await db.delete(clicks).where(lt(clicks.createdAt, cutoff));
    return result.rowCount ?? 0;
  }

  /** Click counts per attributed source, biggest first. */
  sourceBreakdown(id: number) {
    const source = sql<string>`coalesce(${clicks.source}, 'unknown')`;
    const method = sql<string>`coalesce(${clicks.sourceMethod}, 'none')`;
    const clicksCount = count();
    return db
      .select({ source, method, clicks: clicksCount })
      .from(clicks)
      .where(eq(clicks.urlId, id))
      .groupBy(source, method)
      .orderBy(desc(clicksCount), source, method);
  }

  /** Most recent clicks for a URL (for the stats endpoint). */
  recentClicks(id: number, limit: number): Promise<Click[]> {
    return db.query.clicks.findMany({
      where: eq(clicks.urlId, id),
      orderBy: desc(clicks.createdAt),
      limit,
    });
  }
}

export const urlRepository = new UrlRepository();
