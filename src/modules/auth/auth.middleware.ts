import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { ForbiddenError, UnauthorizedError } from "../../common/errors";
import { asyncHandler } from "../../common/asyncHandler";
import { auth } from "../../lib/auth";
import { getMemberRoles } from "../../lib/org-bootstrap";
import { can, type Action, type Resource } from "./permissions";

/**
 * Adds the authenticated user id, active organization (tenant) and the
 * caller's roles in it to the request once verified.
 */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  organizationId?: string;
  /** The caller's roles in the active organization (set by requireOrganization). */
  roles?: string[];
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
 * `requireAuth`. Ensures an organization is active for the session AND that the
 * user is still a member of it: a session's active organization is not cleared
 * when an admin removes someone, so it can't be trusted on its own. Callers can
 * switch tenants via `POST /api/auth/organization/set-active`.
 */
export const requireOrganization = asyncHandler(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.organizationId) {
      throw new ForbiddenError("No active organization. Select one to continue.");
    }
    const roles = await getMemberRoles(req.userId!, req.organizationId);
    if (!roles) throw new ForbiddenError("You are no longer a member of this organization.");
    req.roles = roles;
    next();
  },
);

/**
 * Guards a route by role permission. Must run after `requireOrganization`;
 * uses the roles it loaded, so it costs no extra query.
 */
export const requirePermission =
  <R extends Resource>(resource: R, action: Action<R>) =>
  (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!can(req.roles ?? [], resource, action)) {
      throw new ForbiddenError(`Your role does not allow ${resource}:${action}`);
    }
    next();
  };
