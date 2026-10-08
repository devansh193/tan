import { logger } from "../../common/logger";
import { redis as sharedRedis } from "../../lib/redis";
import { LinkCache, type CachedLink } from "./link-cache";
import { linksRepository, type LinksRepository } from "./links.repository";

const HIT_TTL_S = 3600;
const MISS_TTL_S = 30;
const CHANNEL = "link:invalidate";
const keyOf = (code: string) => `link:${code}`;

type Subscriber = {
  on(event: "error", listener: (err: unknown) => void): unknown;
  connect(): Promise<unknown>;
  subscribe(channel: string, listener: (message: string) => void): Promise<unknown>;
  quit(): Promise<unknown>;
};

/** The node-redis surface this store uses (narrow, so tests can fake it). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  del(keys: string[]): Promise<unknown>;
  publish(channel: string, message: string): Promise<unknown>;
  sendCommand(args: string[]): Promise<unknown>;
  duplicate(): Subscriber;
}

type Stored =
  | { id: number; url: string; expiresAt: string | null; redirectType: 301 | 302 }
  | { missing: true };

const parseCodes = (message: string): string[] => {
  try {
    const codes: unknown = JSON.parse(message);
    return Array.isArray(codes) ? codes.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
};

/**
 * Redirect lookups: in-process LRU (L1) → Redis (L2) → Postgres, with short
 * negative caching. Writers call `invalidate` after a change commits: it drops
 * the codes from L1 and L2 and publishes them so every instance drops its L1.
 * Redis is optional and every Redis failure falls through to Postgres.
 *
 * A read that is still in flight when an invalidation lands (here or via
 * pub/sub) returns what it read but caches nothing, so a slow query can't put
 * an edited or deleted link back. The second invalidation 1 s later covers an
 * instance that finished its read just before the publish reached it.
 */
export class LinkStore {
  private subscriber: Subscriber | null = null;
  /** Bumped on every invalidation; reads that span a bump don't cache. */
  private epoch = 0;

  constructor(
    private readonly repo: Pick<LinksRepository, "findByCode">,
    private readonly redis: RedisLike | null,
    private readonly l1 = new LinkCache(),
    private readonly redelayMs = 1000,
  ) {}

  /** The link behind `code`, or null if there is none. */
  async get(code: string): Promise<CachedLink | null> {
    const cached = this.l1.get(code);
    if (cached !== undefined) return cached;

    const epoch = this.epoch;
    const fromL2 = await this.readL2(code);
    if (fromL2 !== undefined) {
      if (epoch === this.epoch) this.l1.set(code, fromL2);
      return fromL2;
    }

    const row = await this.repo.findByCode(code);
    const link: CachedLink | null = row
      ? {
          id: row.id,
          originalUrl: row.originalUrl,
          expiresAt: row.expiresAt,
          redirectType: row.redirectType === 301 ? 301 : 302,
        }
      : null;
    if (epoch === this.epoch) {
      this.l1.set(code, link);
      void this.writeL2(code, link);
    }
    return link;
  }

  /** Drops `codes` from every instance's caches. Call after the write commits. */
  async invalidate(codes: string[]): Promise<void> {
    await this.drop(codes);
    if (this.redis && codes.length) {
      setTimeout(() => void this.drop(codes), this.redelayMs).unref();
    }
  }

  /** Subscribes to invalidations published by other instances. */
  async start(): Promise<void> {
    if (!this.redis || this.subscriber) return;
    const sub = this.redis.duplicate();
    sub.on("error", (err) => logger.error({ err }, "Link invalidation subscriber error"));
    try {
      await sub.connect();
      await sub.subscribe(CHANNEL, (message) => {
        this.epoch++;
        for (const code of parseCodes(message)) this.l1.delete(code);
      });
      this.subscriber = sub;
    } catch (err) {
      logger.warn({ err }, "Link invalidation subscriber unavailable; L1 relies on its TTL");
    }
  }

  async stop(): Promise<void> {
    await this.subscriber?.quit().catch(() => {});
    this.subscriber = null;
  }

  private async drop(codes: string[]): Promise<void> {
    this.epoch++;
    for (const code of codes) this.l1.delete(code);
    if (!this.redis || !codes.length) return;
    try {
      await this.redis.del(codes.map(keyOf));
      await this.redis.publish(CHANNEL, JSON.stringify(codes));
    } catch (err) {
      logger.warn({ err, codes }, "Link cache invalidation failed; L2 entries expire on their TTL");
    }
  }

  private async readL2(code: string): Promise<CachedLink | null | undefined> {
    if (!this.redis) return undefined;
    try {
      const raw = await this.redis.get(keyOf(code));
      if (raw === null) return undefined;
      const v = JSON.parse(raw) as Stored;
      if ("missing" in v) return null;
      return {
        id: v.id,
        originalUrl: v.url,
        expiresAt: v.expiresAt ? new Date(v.expiresAt) : null,
        redirectType: v.redirectType,
      };
    } catch (err) {
      logger.warn({ err, code }, "Link L2 read failed; using the database");
      return undefined;
    }
  }

  private async writeL2(code: string, link: CachedLink | null): Promise<void> {
    if (!this.redis) return;
    const value: Stored = link
      ? {
          id: link.id,
          url: link.originalUrl,
          expiresAt: link.expiresAt?.toISOString() ?? null,
          redirectType: link.redirectType,
        }
      : { missing: true };
    try {
      await this.redis.sendCommand([
        "SET",
        keyOf(code),
        JSON.stringify(value),
        "EX",
        String(link ? HIT_TTL_S : MISS_TTL_S),
      ]);
    } catch (err) {
      logger.warn({ err, code }, "Link L2 write failed");
    }
  }
}

export const linkStore = new LinkStore(linksRepository, sharedRedis);
