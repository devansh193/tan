import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { clicks, urls, type Click, type Url } from "../../db/schema";

/** Fields needed to create a URL. */
export interface CreateUrlData {
  originalUrl: string;
  organizationId: string;
  userId: string;
  customAlias?: string;
  expiresAt?: Date;
}

/** Metadata captured for a single redirect. */
export interface ClickData {
  ip?: string;
  country?: string;
  state?: string;
  city?: string;
  browser?: string;
  os?: string;
  device?: string;
  referer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}

/** Data-access layer for shortened URLs and their click analytics. */
export class UrlRepository {
  /** Inserts a URL for a user; the DB assigns the bigserial counter id. */
  async create(data: CreateUrlData): Promise<Url> {
    const [row] = await db
      .insert(urls)
      .values({
        originalUrl: data.originalUrl,
        organizationId: data.organizationId,
        userId: data.userId,
        customAlias: data.customAlias ?? null,
        expiresAt: data.expiresAt ?? null,
      })
      .returning();
    return row;
  }

  /** Finds a live (non-deleted) URL by counter id. */
  findById(id: number): Promise<Url | undefined> {
    return db.query.urls.findFirst({
      where: and(eq(urls.id, id), isNull(urls.deletedAt)),
    });
  }

  /** Finds a live URL by its custom alias. */
  findByAlias(alias: string): Promise<Url | undefined> {
    return db.query.urls.findFirst({
      where: and(eq(urls.customAlias, alias), isNull(urls.deletedAt)),
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
      .where(
        and(
          eq(urls.id, id),
          eq(urls.organizationId, organizationId),
          isNull(urls.deletedAt),
        ),
      )
      .returning({ id: urls.id });
    return deleted.length > 0;
  }

  /** Records a click: inserts an analytics row and bumps the counter atomically. */
  async recordClick(id: number, data: ClickData): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(clicks).values({
        urlId: id,
        ip: data.ip ?? null,
        country: data.country ?? null,
        state: data.state ?? null,
        city: data.city ?? null,
        browser: data.browser ?? null,
        os: data.os ?? null,
        device: data.device ?? null,
        referer: data.referer ?? null,
        utmSource: data.utmSource ?? null,
        utmMedium: data.utmMedium ?? null,
        utmCampaign: data.utmCampaign ?? null,
      });
      await tx
        .update(urls)
        .set({ clickCount: sql`${urls.clickCount} + 1` })
        .where(eq(urls.id, id));
    });
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
