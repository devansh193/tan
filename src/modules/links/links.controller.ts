import type { Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import type { AuthenticatedRequest } from "../auth/auth.middleware";
import { canManageAll } from "../auth/permissions";
import type { CreateLinkBody, ListLinksQuery } from "./links.schema";
import { linksService, type Actor } from "./links.service";

const actor = (req: AuthenticatedRequest): Actor => ({
  organizationId: req.organizationId!,
  userId: req.userId!,
  canManageAll: canManageAll(req.roles ?? []),
});

/** HTTP layer for /api/v1/links. */
export const linksController = {
  // POST /api/v1/links — create a link.
  create: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const link = await linksService.create(actor(req), req.body as CreateLinkBody);
    res.status(201).location(`/api/v1/links/${link.id}`).json(link);
  }),

  // GET /api/v1/links — one keyset page of the org's links.
  list: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json(await linksService.list(req.organizationId!, res.locals.query as ListLinksQuery));
  }),

  // GET /api/v1/links/:id — one link.
  get: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    res.json(await linksService.get(req.organizationId!, req.params.id));
  }),

  // DELETE /api/v1/links/:id — soft-delete.
  remove: asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    await linksService.remove(actor(req), req.params.id);
    res.status(204).send();
  }),
};
