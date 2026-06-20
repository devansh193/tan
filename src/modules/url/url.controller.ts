import type { Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import type { AuthenticatedRequest } from "../auth/auth.middleware";
import { urlService } from "./url.service";
import type { ListUrlsQuery } from "./url.schema";

/** HTTP layer for URL shortening, listing, stats, deletion and redirection. */
export const urlController = {
  // POST /api/urls  (auth) — create a short link.
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { url, customAlias, expiresAt } = req.body;
    const view = await urlService.shorten({
      originalUrl: url,
      userId: req.userId!,
      customAlias,
      expiresAt,
    });
    res.status(201).json(view);
  }),

  // GET /api/urls  (auth) — list the caller's short links (paginated).
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { limit, offset } = res.locals.query as ListUrlsQuery;
    const page = await urlService.listForUser(req.userId!, limit, offset);
    res.json(page);
  }),

  // GET /api/urls/:code/stats  (auth) — click stats for an owned link.
  stats: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const view = await urlService.stats(req.params.code, req.userId!);
    res.json(view);
  }),

  // DELETE /api/urls/:code  (auth) — soft-delete an owned link.
  remove: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await urlService.remove(req.params.code, req.userId!);
    res.status(204).send();
  }),

  // GET /:code  (public) — resolve and redirect to the original URL.
  redirect: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query;
    const originalUrl = await urlService.resolve(req.params.code, {
      referer: req.get("referer") ?? undefined,
      userAgent: req.get("user-agent") ?? undefined,
      ip: req.ip,
      utmSource: typeof q.utm_source === "string" ? q.utm_source : undefined,
      utmMedium: typeof q.utm_medium === "string" ? q.utm_medium : undefined,
      utmCampaign: typeof q.utm_campaign === "string" ? q.utm_campaign : undefined,
    });
    res.redirect(302, originalUrl);
  }),
};
