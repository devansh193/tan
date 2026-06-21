import { Router } from "express";
import { validateBody, validateQuery } from "../../common/middleware/validate";
import { requireAuth, requireOrganization } from "../auth/auth.middleware";
import { urlController } from "./url.controller";
import { createUrlSchema, listUrlsQuerySchema } from "./url.schema";

/**
 * Authenticated, tenant-scoped routes for managing short links, mounted under
 * /api/urls. Every operation acts within the caller's active organization.
 */
export const urlRoutes = Router();

urlRoutes.use(requireAuth, requireOrganization);

urlRoutes.post("/", validateBody(createUrlSchema), urlController.create);
urlRoutes.get("/", validateQuery(listUrlsQuerySchema), urlController.list);
urlRoutes.get("/:code/stats", urlController.stats);
urlRoutes.delete("/:code", urlController.remove);
