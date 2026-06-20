import { ConflictError, GoneError, NotFoundError } from "../../common/errors";
import { env } from "../../config/env";
import { logger } from "../../common/logger";
import type { Url } from "../../db/schema";
import { buildClickData, type RedirectMeta } from "./click-analytics";
import { UrlRepository, urlRepository, type CreateUrlData } from "./url.repository";
import { decodeId, encodeId } from "./sqids";

/** Aliases that would collide with real routes and are therefore disallowed. */
const RESERVED_ALIASES = new Set(["api", "health", "ready", "favicon.ico", "robots.txt"]);

const PG_UNIQUE_VIOLATION = "23505";

/** A shortened URL as returned to clients. */
export interface ShortUrlView {
  code: string;
  shortUrl: string;
  originalUrl: string;
  clickCount: number;
  expiresAt: Date | null;
  createdAt: Date;
}

/** A paginated list of short URLs. */
export interface PagedUrls {
  items: ShortUrlView[];
  total: number;
  limit: number;
  offset: number;
}

export type { RedirectMeta } from "./click-analytics";

/**
 * Business logic for shortening and resolving URLs. The default short code is
 * derived from the row's counter id via the Sqids bijection (no collisions);
 * an optional custom alias takes precedence when resolving.
 */
export class UrlService {
  constructor(private readonly repo: UrlRepository) {}

  /** Shortens a URL for the given user, optionally with an alias and expiry. */
  async shorten(input: CreateUrlData): Promise<ShortUrlView> {
    if (input.customAlias && RESERVED_ALIASES.has(input.customAlias.toLowerCase())) {
      throw new ConflictError("Alias is reserved");
    }
    try {
      const url = await this.repo.create(input);
      return this.toView(url);
    } catch (err) {
      if (err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError("Alias already taken");
      }
      throw err;
    }
  }

  /**
   * Resolves a short code to its original URL and records the click.
   * 404 if unknown/malformed, 410 if expired.
   */
  async resolve(code: string, meta: RedirectMeta): Promise<string> {
    const url = await this.lookup(code);
    if (!url) throw new NotFoundError("Short link not found");
    if (url.expiresAt && url.expiresAt.getTime() < Date.now()) {
      throw new GoneError("Short link has expired");
    }

    // Record analytics without delaying the redirect; never let it reject loose.
    this.repo
      .recordClick(url.id, buildClickData(meta))
      .catch((err) => logger.error({ err, urlId: url.id }, "Failed to record click"));

    return url.originalUrl;
  }

  /** Lists a user's URLs with pagination metadata. */
  async listForUser(userId: string, limit: number, offset: number): Promise<PagedUrls> {
    const [rows, total] = await Promise.all([
      this.repo.listByUser(userId, limit, offset),
      this.repo.countByUser(userId),
    ]);
    return { items: rows.map((row) => this.toView(row)), total, limit, offset };
  }

  /** Soft-deletes a URL the user owns. */
  async remove(code: string, userId: string): Promise<void> {
    const url = await this.lookup(code);
    if (!url) throw new NotFoundError("Short link not found");

    const ok = await this.repo.softDelete(url.id, userId);
    // Either the link doesn't exist or it isn't the caller's — same 404.
    if (!ok) throw new NotFoundError("Short link not found");
  }

  /** Returns click stats for a URL the user owns. */
  async stats(code: string, userId: string, recentLimit = 20) {
    const url = await this.lookup(code);
    if (!url || url.userId !== userId) throw new NotFoundError("Short link not found");

    const recent = await this.repo.recentClicks(url.id, recentLimit);
    return { ...this.toView(url), recentClicks: recent };
  }

  /** Resolves a code (alias first, then Sqids id) to a live URL row. */
  private async lookup(code: string): Promise<Url | undefined> {
    const byAlias = await this.repo.findByAlias(code);
    if (byAlias) return byAlias;

    const id = decodeId(code);
    return id === null ? undefined : this.repo.findById(id);
  }

  /** Maps a DB row to the client-facing shape; alias wins over the Sqids code. */
  private toView(url: Url): ShortUrlView {
    const code = url.customAlias ?? encodeId(url.id);
    return {
      code,
      shortUrl: `${env.BASE_URL}/${code}`,
      originalUrl: url.originalUrl,
      clickCount: url.clickCount,
      expiresAt: url.expiresAt,
      createdAt: url.createdAt,
    };
  }
}

export const urlService = new UrlService(urlRepository);
