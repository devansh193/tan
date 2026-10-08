import { GoneError, NotFoundError } from "../../common/errors";
import type { RedirectMeta } from "../analytics/click-analytics";
import { clickRecorder, type ClickRecorder } from "../analytics/click-recorder";
import { isPossibleCode } from "../links/codes";
import { linkStore, type LinkStore } from "../links/link-store";

/** Where to send the visitor, and how. */
export interface Resolved {
  url: string;
  redirectType: 301 | 302;
}

/** Resolves public short codes to destinations and records the click. */
export class RedirectService {
  constructor(
    private readonly links: Pick<LinkStore, "get">,
    private readonly clicks: Pick<ClickRecorder, "enqueue">,
  ) {}

  /** 404 if unknown, 410 if expired; otherwise queues the click. */
  async resolve(code: string, meta: RedirectMeta): Promise<Resolved> {
    // Skip lookups for paths that can't be codes (favicon.ico, /api/…, scans).
    if (!isPossibleCode(code)) throw new NotFoundError("Short link not found");
    const link = await this.links.get(code);
    if (!link) throw new NotFoundError("Short link not found");
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new GoneError("Short link has expired");
    }
    this.clicks.enqueue(link.id, meta);
    return { url: link.originalUrl, redirectType: link.redirectType };
  }
}

export const redirectService = new RedirectService(linkStore, clickRecorder);
