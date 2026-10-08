import { Router } from "express";
import { requireAuth, requireOrganization } from "../modules/auth/auth.middleware";
import { analyticsRoutes } from "../modules/analytics/analytics.routes";
import { linkRoutes } from "../modules/links/links.routes";

/**
 * Management API v1. Every route is authenticated and scoped to the caller's
 * active organization; each resource router adds its own permission checks.
 */
export const v1Routes = Router();

v1Routes.use(requireAuth, requireOrganization);
v1Routes.use("/links", linkRoutes);
v1Routes.use("/analytics", analyticsRoutes);
