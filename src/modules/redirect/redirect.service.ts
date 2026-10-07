import { GoneError, NotFoundError } from "../../common/errors";
import type { RedirectMeta } from "../analytics/click-analytics";
import { clickRecorder, type ClickRecorder } from "../analytics/click-recorder";
import { isPossibleCode } from "../links/codes";
import { linkCache, type LinkCache } from "../links/link-cache";
import { linksRepository, type LinksRepository } from "../links/links.repository";

/** Resolves public short codes to destinations and records the click. */
export class RedirectService {
  constructor(
    private readonly repo: Pick<LinksRepository, "findByCode">,
    private readonly clicks: Pick<ClickRecorder, "enqueue">,
    private readonly cache: LinkCache = linkCache,
  ) {}

  /** 404 if unknown, 410 if expired; otherwise queues the click. */
  async resolve(code: string, meta: RedirectMeta): Promise<string> {
    // Skip the DB for paths that can't be codes (favicon.ico, /api/…, scans).
    if (!isPossibleCode(code)) throw new NotFoundError("Short link not found");
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
}

export const redirectService = new RedirectService(linksRepository, clickRecorder);
