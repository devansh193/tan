import { and, count, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { clicks, urls, type Click } from "../../db/schema";
import { DIMENSIONS, FILTERS, type AnalyticsQuery, type Dimension } from "./analytics.schema";
import type { ClickData } from "./click-analytics";

/**
 * Visitor-days: a visitor counted once per link per day. Estimated from the
 * anonymised IP and user agent until hashed visitor_days land (phase D).
 */
const uniques = sql<number>`count(DISTINCT (${clicks.urlId}, date_trunc('day', ${clicks.createdAt}), ${clicks.ip}, ${clicks.browser}, ${clicks.os}, ${clicks.device}))::int`;

/** A dimension's value. Browser and OS drop their version: "Chrome 152.0.1" counts as "Chrome". */
const valueOf = (column: (typeof FILTERS)[keyof typeof FILTERS]) =>
  column === "browser" || column === "os"
    ? sql<string>`regexp_replace(${clicks[column]}, ' [0-9][0-9A-Za-z._]*$', '')`
    : sql<string>`${clicks[column]}`;

/** Clicks on the org's live links inside the query's range and filters. */
function scope(organizationId: string, q: AnalyticsQuery): SQL {
  const conds: SQL[] = [
    eq(urls.organizationId, organizationId),
    isNull(urls.deletedAt),
    gte(clicks.createdAt, q.start),
    lt(clicks.createdAt, q.end),
  ];
  if (q.linkId) conds.push(inArray(urls.publicId, q.linkId));
  for (const [param, column] of Object.entries(FILTERS)) {
    const values = q[param as keyof typeof FILTERS];
    if (values) conds.push(inArray(valueOf(column), values));
  }
  return and(...conds)!;
}

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

  /** Clicks and uniques per interval bucket in `timezone`, gaps filled with zeros. */
  async timeseries(organizationId: string, q: AnalyticsQuery) {
    const { interval, timezone: tz } = q;
    const result = await db.execute<{ start: string; clicks: number; uniques: number }>(sql`
      WITH agg AS (
        SELECT date_trunc(${interval}, ${clicks.createdAt} AT TIME ZONE ${tz}) AS b,
               count(*)::int AS clicks, ${uniques} AS uniques
        FROM ${clicks} JOIN ${urls} ON ${urls.id} = ${clicks.urlId}
        WHERE ${scope(organizationId, q)}
        GROUP BY 1
      )
      SELECT to_json(s.b AT TIME ZONE ${tz}) AS start,
             coalesce(agg.clicks, 0) AS clicks, coalesce(agg.uniques, 0) AS uniques
      FROM generate_series(
        date_trunc(${interval}, ${q.start}::timestamptz AT TIME ZONE ${tz}),
        date_trunc(${interval}, (${q.end}::timestamptz - interval '1 millisecond') AT TIME ZONE ${tz}),
        ${`1 ${interval}`}::interval
      ) AS s(b)
      LEFT JOIN agg ON agg.b = s.b
      ORDER BY s.b`);
    return result.rows;
  }

  /** Top 100 values of one dimension; sources are split by attribution method. */
  breakdown(organizationId: string, q: AnalyticsQuery, dim: Dimension) {
    const value = sql<string>`coalesce(${valueOf(DIMENSIONS[dim])}, 'unknown')`;
    const method = sql<string>`coalesce(${clicks.sourceMethod}, 'none')`;
    const clicksCount = count();
    const bySource = dim === "sources";
    return db
      .select({ value, ...(bySource && { method }), clicks: clicksCount, uniques })
      .from(clicks)
      .innerJoin(urls, eq(urls.id, clicks.urlId))
      .where(scope(organizationId, q))
      .groupBy(...(bySource ? [value, method] : [value]))
      .orderBy(desc(clicksCount), value)
      .limit(100);
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
