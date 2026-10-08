import { Router, type Response } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { validateQuery } from "../../common/middleware/validate";
import { requirePermission, type AuthenticatedRequest } from "../auth/auth.middleware";
import { analyticsRepository } from "./analytics.repository";
import { analyticsQuerySchema, type AnalyticsQuery } from "./analytics.schema";

/** /api/v1/analytics — mounted behind requireAuth + requireOrganization (routes/v1.ts). */
export const analyticsRoutes = Router();

analyticsRoutes.get(
  "/",
  requirePermission("analytics", "read"),
  validateQuery(analyticsQuerySchema),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const q = res.locals.query as AnalyticsQuery;
    const org = req.organizationId!;
    const data =
      q.groupBy === "timeseries"
        ? await analyticsRepository.timeseries(org, q)
        : await analyticsRepository.breakdown(org, q, q.groupBy);
    res.json({ data });
  }),
);
