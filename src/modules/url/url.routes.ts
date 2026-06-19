import { Router } from "express";
import { validateBody, validateQuery } from "../../common/middleware/validate";
import { requireAuth } from "../auth/auth.middleware";
import { urlController } from "./url.controller";
import { createUrlSchema, listUrlsQuerySchema } from "./url.schema";

/** Authenticated routes for managing short links, mounted under /api/urls. */
export const urlRoutes = Router();

urlRoutes.use(requireAuth);

urlRoutes.post("/", validateBody(createUrlSchema), urlController.create);
urlRoutes.get("/", validateQuery(listUrlsQuerySchema), urlController.list);
urlRoutes.get("/:code/stats", urlController.stats);
urlRoutes.delete("/:code", urlController.remove);
