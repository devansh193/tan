import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { UnauthorizedError } from "../../common/errors";
import { asyncHandler } from "../../common/asyncHandler";
import { auth } from "../../lib/auth";

/** Adds the authenticated user id to the request once verified. */
export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Guards routes that require authentication. Resolves the session from the
 * request — the `bearer` plugin accepts an `Authorization: Bearer <token>`
 * header (the session token returned on sign-in), so no cookies are required.
 * Attaches `req.userId` on success, otherwise throws 401.
 */
export const requireAuth = asyncHandler(
  async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new UnauthorizedError("Authentication required");
    req.userId = session.user.id;
    next();
  },
);
