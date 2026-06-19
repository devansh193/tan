import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError } from "../../common/errors";
import { verifyAccessToken } from "./token";

/** Adds the authenticated user id to the request once verified. */
export interface AuthenticatedRequest extends Request {
  userId?: string;
}

/**
 * Guards routes that require a valid access token. Expects an
 * `Authorization: Bearer <token>` header and attaches `req.userId` on success.
 */
export const requireAuth = (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }

  const token = header.slice("Bearer ".length).trim();
  const payload = verifyAccessToken(token);
  req.userId = payload.sub;
  next();
};
