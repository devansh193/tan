import { ConflictError, ForbiddenError, GoneError, NotFoundError } from "../../common/errors";
import { env } from "../../config/env";
import type { Url } from "../../db/schema";
import { assertSafeUrl } from "../../lib/safe-browsing";
import { CHANNELS } from "./attribution";
import type { RedirectMeta } from "./click-analytics";
import { ClickRecorder } from "./click-recorder";
import { LinkCache } from "./link-cache";
import { generateCode } from "./short-code";
import { UrlRepository, urlRepository, type CreateUrlData } from "./url.repository";

/** Aliases that would collide with real routes and are therefore disallowed. */
const RESERVED_ALIASES = new Set(["api", "health", "ready", "favicon.ico", "robots.txt"]);

/** Every code (alias or generated) has this shape; anything else can't exist. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

const PG_UNIQUE_VIOLATION = "23505";
const MAX_CODE_ATTEMPTS = 5;

/** Input for shortening: the code is either the alias or generated. */
export type ShortenInput = Omit<CreateUrlData, "code"> & { customAlias?: string };

/** A shortened URL as returned to clients. */
export interface ShortUrlView {
  code: string;
  shortUrl: string;
  originalUrl: string;
  /** Per-platform share links, e.g. `{ instagram: "https://…/abc1234/ig" }`. */
  shareUrls: Record<string, string>;
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

const isUniqueViolation = (err: unknown) =>
  !!err && typeof err === "object" && "code" in err && err.code === PG_UNIQUE_VIOLATION;

/**
 * Business logic for shortening and resolving URLs. Every link has exactly one
 * code in a single unique column: either the caller's alias or a random code.
 * One namespace means an alias can never shadow another link.
 */
export class UrlService {
  constructor(
    private readonly repo: UrlRepository,
    private readonly clicks: Pick<ClickRecorder, "enqueue">,
    private readonly cache = new LinkCache(),
  ) {}

  /** Shortens a URL for the given user, optionally with an alias and expiry. */
  async shorten({ customAlias, ...input }: ShortenInput): Promise<ShortUrlView> {
    if (customAlias && RESERVED_ALIASES.has(customAlias.toLowerCase())) {
      throw new ConflictError("Alias is reserved");
    }
    await assertSafeUrl(input.originalUrl);

    if (customAlias) {
      try {
        return this.toView(await this.repo.create({ ...input, code: customAlias }));
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictError("Alias already taken");
        throw err;
      }
    }

    // Random codes rarely collide; the unique constraint catches it and we retry.
    for (let attempt = 1; ; attempt++) {
      try {
        return this.toView(await this.repo.create({ ...input, code: generateCode() }));
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= MAX_CODE_ATTEMPTS) throw err;
      }
    }
  }

  /**
   * Resolves a short code to its original URL and queues the click.
   * 404 if unknown, 410 if expired.
   */
  async resolve(code: string, meta: RedirectMeta): Promise<string> {
    // Skip the DB for paths that can't be codes (favicon.ico, /api/…, scans).
    if (!CODE_PATTERN.test(code) || RESERVED_ALIASES.has(code.toLowerCase())) {
      throw new NotFoundError("Short link not found");
    }
    let link = this.cache.get(code);
    if (!link) {
      const url = await this.repo.findByCode(code);
      if (!url) throw new NotFoundError("Short link not found");
      link = { id: url.id, originalUrl: url.originalUrl, expiresAt: url.expiresAt };
      this.cache.set(code, link);
    }
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new GoneError("Short link has expired");
    }

    this.clicks.enqueue(link.id, meta);
    return link.originalUrl;
  }

  /** Lists an organization's URLs with pagination metadata. */
  async listForOrganization(
    organizationId: string,
    limit: number,
    offset: number,
  ): Promise<PagedUrls> {
    const [rows, total] = await Promise.all([
      this.repo.listByOrganization(organizationId, limit, offset),
      this.repo.countByOrganization(organizationId),
    ]);
    return { items: rows.map((row) => this.toView(row)), total, limit, offset };
  }

  /**
   * Soft-deletes a URL owned by the caller's organization. Plain members may
   * only delete links they created; owners/admins may delete any.
   */
  async remove(
    code: string,
    actor: { organizationId: string; userId: string; isOrgAdmin: boolean },
  ): Promise<void> {
    const { organizationId } = actor;
    const url = await this.repo.findByCode(code);
    if (!url || url.organizationId !== organizationId) {
      throw new NotFoundError("Short link not found");
    }
    if (!actor.isOrgAdmin && url.userId !== actor.userId) {
      throw new ForbiddenError("Only organization admins can delete other members' links");
    }

    const ok = await this.repo.softDelete(url.id, organizationId);
    // Either the link doesn't exist or it isn't the org's — same 404.
    if (!ok) throw new NotFoundError("Short link not found");
    this.cache.delete(code);
  }

  /** Returns click stats for a URL owned by the caller's organization. */
  async stats(code: string, organizationId: string, recentLimit = 20) {
    const url = await this.repo.findByCode(code);
    if (!url || url.organizationId !== organizationId) {
      throw new NotFoundError("Short link not found");
    }

    const [sources, recent] = await Promise.all([
      this.repo.sourceBreakdown(url.id),
      this.repo.recentClicks(url.id, recentLimit),
    ]);
    return { ...this.toView(url), sources, recentClicks: recent };
  }

  /** Maps a DB row to the client-facing shape. */
  private toView(url: Url): ShortUrlView {
    const shortUrl = `${env.BASE_URL}/${url.code}`;
    return {
      code: url.code,
      shortUrl,
      originalUrl: url.originalUrl,
      shareUrls: Object.fromEntries(
        Object.entries(CHANNELS).map(([tag, name]) => [name, `${shortUrl}/${tag}`]),
      ),
      clickCount: url.clickCount,
      expiresAt: url.expiresAt,
      createdAt: url.createdAt,
    };
  }
}

export const clickRecorder = new ClickRecorder(urlRepository);
export const urlService = new UrlService(urlRepository, clickRecorder);
