import { GoneError, NotFoundError } from "../../common/errors";
import { channelUtm } from "../analytics/attribution";
import type { RedirectMeta } from "../analytics/click-analytics";
import { clickRecorder, type ClickRecorder } from "../analytics/click-recorder";
import { isPossibleCode } from "../links/codes";
import { linkStore, type LinkStore } from "../links/link-store";
import { applyUtm } from "../links/utm";

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
    // With autoUtm, a share-tag click tells the destination which platform it
    // came from, matching how tan attributes it; campaign/term/content stay.
    const platform = link.autoUtm ? channelUtm(meta.channel) : undefined;
    const url = platform ? applyUtm(link.originalUrl, platform) : link.originalUrl;
    return { url, redirectType: link.redirectType };
  }
}

export const redirectService = new RedirectService(linkStore, clickRecorder);
