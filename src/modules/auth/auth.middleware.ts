import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ForbiddenError, UnauthorizedError } from "../../common/errors";
import { asyncHandler } from "../../common/asyncHandler";
import { auth } from "../../lib/auth";

/**
 * Adds the authenticated user id and active organization (tenant) to the
 * request once verified.
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  organizationId?: string;
}

/**
 * Guards routes that require authentication. Resolves the session from the
 * request — the `bearer` plugin accepts an `Authorization: Bearer <token>`
 * header (the session token returned on sign-in), so no cookies are required.
 * Attaches `req.userId` and the active `req.organizationId` (from the
 * organization plugin) on success, otherwise throws 401.
 */
export const requireAuth = asyncHandler(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthorizedError("Authentication required");
    req.userId = session.user.id;
    req.organizationId = session.session.activeOrganizationId ?? undefined;
    next();
  },
);

/**
 * Guards routes that operate on tenant-scoped resources. Must run after
 * `requireAuth`. Ensures an organization is active for the session; callers can
 * switch tenants via `POST /api/auth/organization/set-active`.
 */
export const requireOrganization = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void => {
  // Synchronous guard: Express forwards thrown errors to the error handler.
  if (!req.organizationId) {
    throw new ForbiddenError("No active organization. Select one to continue.");
  }
  next();
};
