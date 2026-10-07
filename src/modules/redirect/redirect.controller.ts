import type { Request, Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { redirectService } from "./redirect.service";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Public redirect handler. */
export const redirectController = {
  // GET /:code[/:channel] — the optional channel tag (`/abc1234/ig`) attributes
  // the click to a platform.
  redirect: asyncHandler(async (req: Request, res: Response) => {
    const q = req.query;
    const destination = await redirectService.resolve(req.params.code, {
      referer: req.get("referer") ?? undefined,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
      utmSource: str(q.utm_source),
      utmMedium: str(q.utm_medium),
      utmCampaign: str(q.utm_campaign),
      channel: req.params.channel,
      queryKeys: Object.keys(q),
    });
    res.redirect(302, destination);
  }),
};
