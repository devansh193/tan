import { count, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { clicks, urls, type Click } from "../../db/schema";
import type { ClickData } from "./click-analytics";

/** One click to persist, as buffered by the ClickRecorder. */
export interface ClickRow extends ClickData {
  urlId: number;
  createdAt: Date;
}

/** Data access for click analytics. */
export class AnalyticsRepository {
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
  sourceBreakdown(urlId: number) {
    const source = sql<string>`coalesce(${clicks.source}, 'unknown')`;
    const method = sql<string>`coalesce(${clicks.sourceMethod}, 'none')`;
    const clicksCount = count();
    return db
      .select({ source, method, clicks: clicksCount })
      .from(clicks)
      .where(eq(clicks.urlId, urlId))
      .groupBy(source, method)
      .orderBy(desc(clicksCount), source, method);
  }

  /** Most recent clicks for a URL. */
  recentClicks(urlId: number, limit: number): Promise<Click[]> {
    return db.query.clicks.findMany({
      where: eq(clicks.urlId, urlId),
      orderBy: desc(clicks.createdAt),
      limit,
    });
  }
}

export const analyticsRepository = new AnalyticsRepository();
