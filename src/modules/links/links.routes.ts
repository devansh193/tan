import { Router } from "express";
import { validateBody, validateQuery } from "../../common/middleware/validate";
import { requirePermission } from "../auth/auth.middleware";
import { linksController } from "./links.controller";
import { createLinkSchema, listLinksQuerySchema, updateLinkSchema } from "./links.schema";

/** /api/v1/links — mounted behind requireAuth + requireOrganization (routes/v1.ts). */
export const linkRoutes = Router();

linkRoutes.post(
  "/",
  requirePermission("link", "create"),
  validateBody(createLinkSchema),
  linksController.create,
);
linkRoutes.get(
  "/",
  requirePermission("link", "read"),
  validateQuery(listLinksQuerySchema),
  linksController.list,
);
linkRoutes.get("/:id", requirePermission("link", "read"), linksController.get);
linkRoutes.patch(
  "/:id",
  requirePermission("link", "update"),
  validateBody(updateLinkSchema),
  linksController.update,
);
linkRoutes.delete("/:id", requirePermission("link", "delete"), linksController.remove);
